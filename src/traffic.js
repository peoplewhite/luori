import * as THREE from 'three';
import { LOOP, LANE, gap, sample, worldAt, mat, rng } from './road.js';

export const CAR_L = 4.6, CAR_W = 1.8;
const { clamp } = THREE.MathUtils;

// Shared low-poly sedan parts; forward is -Z.
const bodyGeo = new THREE.BoxGeometry(CAR_W, 0.62, CAR_L);
const cabinGeo = new THREE.BoxGeometry(1.6, 0.6, 2.5);
{
  const p = cabinGeo.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) p.setZ(i, p.getZ(i) * 0.62); // sloped screens
  cabinGeo.computeVertexNormals();
}
const roofGeo = new THREE.BoxGeometry(1.62, 0.06, 1.6);
const lampGeo = new THREE.BoxGeometry(0.42, 0.16, 0.05);
const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.26, 10).rotateZ(Math.PI / 2);
export const parts = { glass: mat('#53627e'), tyre: mat('#2f2c2c'), head: mat('#fff6dc'), tail: mat('#d64545') };

/** Returns { root, body, wheels }: `root` is placed on the road, `body` may sway, wheels spin/steer. */
export function makeCar(color) {
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body);
  const paint = mat(color);
  const add = (parent, geo, m, x, y, z) => {
    const o = new THREE.Mesh(geo, m);
    o.position.set(x, y, z);
    o.castShadow = true;
    parent.add(o);
    return o;
  };
  add(body, bodyGeo, paint, 0, 0.62, 0);
  add(body, cabinGeo, parts.glass, 0, 1.22, 0.25);
  add(body, roofGeo, paint, 0, 1.55, 0.25);
  for (const x of [-0.62, 0.62]) {
    add(body, lampGeo, parts.head, x, 0.74, -CAR_L / 2 - 0.01);
    add(body, lampGeo, parts.tail, x, 0.78, CAR_L / 2 + 0.01);
  }
  const wheels = [-1.45, 1.45].flatMap((z) =>
    [-0.82, 0.82].map((x) => {
      const w = add(root, wheelGeo, parts.tyre, x, 0.34, z);
      w.rotation.order = 'YXZ';
      return w;
    }),
  );
  return { root, body, wheels };
}

const PALETTE = ['#f4ede1', '#9cc5d9', '#a8d5ba', '#f2c57c', '#c9c3d9', '#8fa3b8', '#f0a3a3', '#e8e2d6'];
const laneLat = (lane) => (lane - 1) * LANE;

/** AI cars spread around the loop, keeping clear of the player's start position. */
export function createTraffic(scene, count, startS) {
  const rand = rng(11);
  return Array.from({ length: count }, (_, i) => {
    const lane = Math.floor(rand() * 3);
    // Mostly slower than the player's 110 km/h so you keep passing cars; a few fast ones pass you.
    const cruise = (rand() < 0.15 ? 105 + rand() * 13 : 60 + rand() * 40) / 3.6;
    const { root } = makeCar(PALETTE[i % PALETTE.length]);
    scene.add(root);
    const s = (startS + 40 + (i / count) * (LOOP - 80) + rand() * 30) % LOOP;
    return { s, lat: laneLat(lane), lane, v: cruise, cruise, latV: 0, root };
  });
}

// Nearest vehicle ahead whose lateral position overlaps `lat`.
function leader(c, lat, all) {
  let best = { d: Infinity, v: 0 };
  for (const o of all) {
    const d = gap(c.s, o.s);
    if (o !== c && d > 0 && d < best.d && Math.abs(o.lat - lat) < 2.4) best = { d, v: o.v };
  }
  return best;
}

/** `player` needs { s, lat, v }; it is treated as just another obstacle. */
export function updateTraffic(cars, player, dt) {
  const all = [...cars, player];
  for (const c of cars) {
    const lead = leader(c, c.lat, all);
    const target = lead.d < 90 ? Math.min(c.cruise, lead.v + (lead.d - 14) * 0.25) : c.cruise; // settle ~14 m behind
    c.v = Math.max(0, c.v + clamp(target - c.v, -8 * dt, 2 * dt));

    // Held up and settled in lane: try the passing lane (left) first, then right.
    if (lead.d < 45 && lead.v < c.cruise - 2 && Math.abs(c.lat - laneLat(c.lane)) < 0.1) {
      const free = (lane) =>
        lane >= 0 && lane <= 2 &&
        all.every((o) => o === c || Math.abs(o.lat - laneLat(lane)) > 2.4 || gap(c.s, o.s) < -20 || gap(c.s, o.s) > 35);
      c.lane = [c.lane - 1, c.lane + 1].find(free) ?? c.lane;
    }
    c.latV = clamp(laneLat(c.lane) - c.lat, -1, 1) * 1.2;
    c.lat += c.latV * dt;
    c.s = (c.s + c.v * dt) % LOOP;
  }
}

export function renderTraffic(cars) {
  for (const c of cars) {
    c.root.position.copy(worldAt(c.s, c.lat));
    c.root.rotation.y = -(sample(c.s).th + Math.atan2(c.latV, Math.max(c.v, 1)));
  }
}
