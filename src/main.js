import * as THREE from 'three';
import { buildWorld, sample, worldAt, curvature, gap, LANE, LOOP } from './road.js';
import { makeCar, createTraffic, updateTraffic, renderTraffic, drive, laneFree, parts, CAR_L, CAR_W } from './traffic.js';
import { themeFor } from './theme.js';
import { sound, updateAudio, bgmPlaying, audioDebug, BGM } from './audio.js';

// Arcade tuning (metres, seconds)
const VMAX = 110 / 3.6, VREV = -6, ACC = 3.2, BRAKE = 9, REV_ACC = 2.5, DRAG = 0.5;
const LAT_MIN = -5.45, LAT_MAX = 7.85; // car centre limits between median barrier and guardrail
const ALIGN = 1.6, TRAFFIC = 24, AUTO_V = 100 / 3.6; // 24 cars in the 2.8 km around the player, as dense as before

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
  document.body.style.background = $('fade').style.background = theme.fog[0];
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
  });
}
setMode(mode);
setInterval(() => applyTheme(themeFor(mode)), 60000); // real mode flips day/night at 06:00 / 18:00 Taiwan time

// --- Input
const keys = { up: false, down: false, left: false, right: false };
const KEYMAP = { KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right' };
// Autopilot: any real input hands control back. Modifier keys alone (e.g. Cmd+Tab away) don't count.
const MODIFIERS = ['Meta', 'Control', 'Alt', 'Shift'];
addEventListener('keydown', (e) => {
  begin();
  if (auto && !MODIFIERS.includes(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) setAuto(false);
  if (KEYMAP[e.code]) {
    keys[KEYMAP[e.code]] = true;
    e.preventDefault();
  }
});
addEventListener('keyup', (e) => KEYMAP[e.code] && (keys[KEYMAP[e.code]] = false));
addEventListener('blur', () => Object.keys(keys).forEach((k) => (keys[k] = false)));
for (const b of document.querySelectorAll('[data-k]')) {
  const set = (on) => (e) => {
    if (on && auto) setAuto(false); // the pad is manual driving
    keys[b.dataset.k] = on;
    b.classList.toggle('on', on);
    e.preventDefault();
  };
  b.addEventListener('pointerdown', set(true));
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, set(false));
}
// Installed PWA (home screen): no touch pad, autopilot by default, and only a real keyboard takes over.
const PWA = matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || navigator.standalone === true;
document.documentElement.classList.toggle('pwa', PWA);
const COARSE = matchMedia('(pointer: coarse)').matches;
// Simplest touch: tap the left / right half of the road to change lane, autopilot does the rest.
$('c').addEventListener('pointerdown', (e) => {
  if (!auto) setAuto(true);
  const lane = st.lane + (e.clientX < innerWidth / 2 ? -1 : 1);
  if (laneFree(st, lane, [...traffic, st])) st.lane = lane; // shortcut: a blocked lane ignores the tap, queue it if that feels unresponsive
});

// --- State
const st = { s: 100, lat: LANE, psi: 0, v: 0, steer: 0, spin: 0, shake: 0, camH: sample(100).th, roll: { x: 0, v: 0 }, pitch: { x: 0, v: 0 } };
const traffic = createTraffic(scene, TRAFFIC, st.s);

let auto = false;
function setAuto(on) {
  auto = on;
  $('auto').setAttribute('aria-pressed', on);
  document.body.classList.toggle('auto', on);
  // On autopilot the player runs the same driver as the AI cars; off again, drop the lane claim others respect.
  if (on) Object.assign(st, { lane: clamp(Math.round(st.lat / LANE) + 1, 0, 2), cruise: AUTO_V, latV: 0 });
  else st.lane = null;
  syncWake();
}

// --- Keep the screen on while autopilot drives. Off by default on phones to save battery.
const WAKE_KEY = 'luori.wake';
let wakeOn = (store(WAKE_KEY) ?? (COARSE ? '0' : '1')) === '1', lock = null;
function syncWake() {
  $('wake').setAttribute('aria-pressed', wakeOn);
  const want = wakeOn && auto && !document.hidden;
  if (want && !lock) lock = navigator.wakeLock?.request('screen').catch(() => (lock = null));
  if (!want && lock) {
    lock.then((l) => l?.release());
    lock = null;
  }
}
$('wake').hidden = !navigator.wakeLock;
$('wake').addEventListener('click', () => {
  wakeOn = !wakeOn;
  store(WAKE_KEY, wakeOn ? '1' : '0');
  syncWake();
});
// The browser drops the lock whenever the page is hidden; take it again on return.
document.addEventListener('visibilitychange', () => {
  lock = null;
  syncWake();
});

// --- Fullscreen (not offered where the API is missing, e.g. iPhone Safari, or already full screen as a PWA).
$('fs').hidden = PWA || !document.fullscreenEnabled;
$('fs').addEventListener('click', () =>
  (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().then(() => screen.orientation?.lock?.('landscape'))).catch(() => {}),
);
document.addEventListener('fullscreenchange', () => $('fs').setAttribute('aria-pressed', !!document.fullscreenElement));
const AUTO_KEY = 'luori.auto';
$('auto').addEventListener('click', () => {
  setAuto(!auto);
  store(AUTO_KEY, auto ? '1' : '0'); // only an explicit icon choice is remembered
});
setAuto((store(AUTO_KEY) ?? (PWA ? '1' : '0')) === '1');

// Keep focus off the icons so driving keys don't show a focus ring or re-trigger them.
$('ui').addEventListener('click', (e) => e.target.closest('button')?.blur());
// Icons fade after a few idle seconds; any input brings them back.
let idleTimer;
function poke() {
  document.body.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => document.body.classList.add('idle'), 3000);
}
for (const ev of ['pointermove', 'pointerdown', 'keydown']) addEventListener(ev, poke, true);
poke();

// --- Sound: mobile browsers only play audio after a tap, hence the "tap to start" card.
const SOUND_KEY = 'luori.sound';
let soundOn = store(SOUND_KEY) !== '0', started = false;
function begin() {
  if (started) return;
  started = true;
  $('start').remove();
  sound(soundOn);
}
$('start').addEventListener('click', begin);
$('snd').setAttribute('aria-pressed', soundOn);
$('snd').addEventListener('click', () => {
  soundOn = !soundOn;
  store(SOUND_KEY, soundOn ? '1' : '0');
  $('snd').setAttribute('aria-pressed', soundOn);
  if (started) sound(soundOn);
  if (soundOn && bgmPlaying()) nowPlaying();
});
// Song credit, top-left: fades in when the music starts, then out again.
$('np').textContent = `♪ ${BGM.title} — ${BGM.artist}`;
let npTimer;
function nowPlaying() {
  $('np').classList.add('show');
  clearTimeout(npTimer);
  npTimer = setTimeout(() => $('np').classList.remove('show'), 7000);
}
// iOS interrupts audio when the app is backgrounded; try to pick it up again on return.
document.addEventListener('visibilitychange', () => started && soundOn && !document.hidden && sound(true));

// --- Screenshot: render then read the canvas in the same task (toBlob copies it right away),
// so no preserveDrawingBuffer cost on every frame. Phones get the share sheet ("Save image"), desktops a download.
$('shot').addEventListener('click', () => {
  renderer.render(scene, camera);
  renderer.domElement.toBlob((blob) => {
    const local = new Date(Date.now() - new Date().getTimezoneOffset() * 6e4);
    const file = new File([blob], `luori-${local.toISOString().slice(0, 19).replace(/\D/g, '')}.png`, { type: 'image/png' });
    const download = () => {
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(file), download: file.name });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    if (COARSE && navigator.canShare?.({ files: [file] })) navigator.share({ files: [file] }).catch((e) => e.name !== 'AbortError' && download());
    else download();
  }, 'image/png');
});

// Slightly under-damped spring, gives the body a soft wobble.
function spring(o, target, dt) {
  o.v += ((target - o.x) * 40 - o.v * 7) * dt;
  o.x += o.v * dt;
}

function update(dt) {
  const [a, yaw] = auto ? autoStep(dt) : manualStep(dt);
  updateTraffic(traffic, st, dt);
  bumpTraffic();

  st.shake = Math.max(0, st.shake - dt * 3);
  spring(st.roll, clamp(st.v * yaw * 0.012, -0.05, 0.05), dt);
  spring(st.pitch, clamp(a * 0.005, -0.04, 0.04), dt);
  st.spin += (st.v * dt) / 0.34;
  st.s = ((st.s % LOOP) + LOOP) % LOOP; // past Kaohsiung comes Keelung again
}

// Returns [acceleration, steering yaw rate] for the body sway springs.
function autoStep(dt) {
  const { v, psi } = st;
  drive(st, [...traffic, st], dt);
  st.psi = Math.atan2(st.latV, Math.max(st.v, 1));
  st.steer = st.latV * 0.5;
  return dt ? [(st.v - v) / dt, (st.psi - psi) / dt] : [0, 0];
}

function manualStep(dt) {
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
  st.lat += st.v * Math.sin(st.psi) * dt;
  if (st.lat < LAT_MIN || st.lat > LAT_MAX) {
    st.lat = clamp(st.lat, LAT_MIN, LAT_MAX);
    st.psi *= Math.max(0, 1 - 10 * dt);
    st.v *= 1 - 0.4 * dt; // gentle scrape, not a punishment
    st.shake = Math.min(1, Math.abs(st.v) / 10);
  }
  return [a, yaw];
}

// Arcade contact: no crashes, just push apart and bleed speed.
let bumps = 0;
function bumpTraffic() {
  for (const c of traffic) {
    const ds = gap(st.s, c.s), dl = c.lat - st.lat;
    const ps = CAR_L - Math.abs(ds), pl = CAR_W + 0.1 - Math.abs(dl);
    if (ps <= 0 || pl <= 0) continue;
    bumps++;
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

const UP = new THREE.Vector3(0, 1, 0), sunDir = new THREE.Vector3();
const fwd = (h) => new THREE.Vector3(Math.sin(h), 0, -Math.cos(h));
// The route isn't a loop: fade into the haze over the last 150 m before Kaohsiung, wrap to Keelung, fade back in.
const fadeAt = (s) => clamp(Math.max((s - (LOOP - 170)) / 150, 1 - s / 80), 0, 1);
let fade = -1;
function render(dt, t) {
  world.update(st.s);
  const p = sample(st.s), h = p.th + st.psi, pos = worldAt(st.s, st.lat);
  if (pos.distanceToSquared(car.root.position) > 2500) st.camH = h; // the seam jump: don't swing the camera across
  car.root.position.copy(pos);
  car.root.rotation.set(Math.atan(p.grade), -h, 0);
  if (fadeAt(st.s) !== fade) $('fade').style.opacity = fade = fadeAt(st.s);
  const bob = Math.sin(t * 13) * 0.003 * Math.min(Math.abs(st.v) / 10, 1);
  car.body.rotation.set(st.pitch.x + bob, 0, st.roll.x);
  car.wheels.forEach((w, i) => {
    w.rotation.x = -st.spin;
    if (i < 2) w.rotation.y = -st.steer * 0.45;
  });
  renderTraffic(traffic, st.s);
  world.follow.position.copy(car.root.position);

  // Chase camera: heading eases toward the car's, distance fixed so speed never drags it away.
  // Wrap the difference so the camera always turns the short way round.
  const dh = h - st.camH;
  st.camH += Math.atan2(Math.sin(dh), Math.cos(dh)) * (1 - Math.exp(-4 * dt));
  world.sky.position.copy(world.follow.position);
  world.sky.rotation.y = -st.camH;
  world.sun.position.copy(car.root.position).addScaledVector(sunDir.copy(theme.sunDir).applyAxisAngle(UP, -st.camH), 80);
  const f = fwd(st.camH);
  camera.position
    .copy(car.root.position)
    .addScaledVector(f, -8.5 - Math.abs(st.v) * 0.05)
    .setY(pos.y + 3.1 + (Math.random() - 0.5) * 0.15 * st.shake);
  camera.lookAt(car.root.position.clone().addScaledVector(f, 7).setY(pos.y + 1.1));
  const fov = 58 + Math.abs(st.v) * 0.3;
  if (Math.abs(camera.fov - fov) > 0.01) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
  renderer.render(scene, camera);
  updateAudio(st.v, dt, nowPlaying);
}

function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();
// Landscape only. Locking works in installed PWAs / fullscreen on Android; elsewhere a CSS overlay asks to rotate.
screen.orientation?.lock?.('landscape')?.catch(() => {});

let last = 0;
renderer.setAnimationLoop((ms) => {
  const t = ms / 1000, dt = Math.min(t - last || 0, 0.1);
  last = t;
  update(dt);
  render(dt, t);
});

// Handle for headless verification; step() runs the simulation without rendering.
window.__luori = {
  bumps: () => bumps,
  audio: audioDebug,
  setAuto,
  seek: (s) => (st.s = s),
  loop: LOOP,
  step(sec, dt = 1 / 60, draw = false) {
    for (let i = 0; i < sec / dt; i++) {
      update(dt);
      if (draw) render(dt, 0);
    }
  },
  get sunNdc() {
    return world.sky.children.at(-1).getWorldPosition(new THREE.Vector3()).project(camera);
  },
  get gpu() { return { ...renderer.info.memory }; }, get theme() { return { mode, night: theme.night, fog: theme.fog[0] }; }, get state() { return { ...st, traffic: traffic.map(({ s, lat, v }) => ({ s, lat, v })) }; } };

if (import.meta.env.PROD && 'serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');
