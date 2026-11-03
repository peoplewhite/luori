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
  root.rotation.order = 'YXZ'; // heading, then pitch with the grade
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

// Traffic only exists around the player (the route is 375 km): cars that drop BACK behind come back ahead, just past
// the fog, and cars that pull FRONT ahead come back from behind.
const BACK = 500, FRONT = 2300;
const rand = rng(11);

/** AI cars spread from BACK behind to FRONT ahead of the player's start, keeping clear of it. */
export function createTraffic(scene, count, startS) {
  return Array.from({ length: count }, (_, i) => {
    const lane = Math.floor(rand() * 3);
    // Mostly slower than the player's 110 km/h so you keep passing cars; a few fast ones pass you.
    const cruise = (rand() < 0.15 ? 105 + rand() * 13 : 60 + rand() * 40) / 3.6;
    const { root } = makeCar(PALETTE[i % PALETTE.length]);
    scene.add(root);
    const d = -BACK + 20 + ((i + rand() * 0.5) / count) * (BACK + FRONT - 70);
    const s = (startS + (Math.abs(d) < 30 ? d + 60 : d) + LOOP) % LOOP;
    return { s, lat: laneLat(lane), lane, v: cruise, cruise, latV: 0, root };
  });
}

function recycle(c, player, all) {
  const d = gap(player.s, c.s);
  if (d > -BACK && d < FRONT) return;
  const was = c.s;
  c.s = (player.s + (d < 0 ? FRONT - 50 - rand() * 300 : -BACK + 20 + rand() * 100) + LOOP) % LOOP;
  const lanes = [0, 1, 2].filter((lane) => laneFree(c, lane, all));
  if (!lanes.length) return void (c.s = was); // no gap there now, try again next frame
  c.lane = lanes[Math.floor(rand() * lanes.length)];
  Object.assign(c, { lat: laneLat(c.lane), latV: 0, v: c.cruise });
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

/**
 * A lane `c` may move into: no car in it, or already moving into it, from 20 m behind to 35 m ahead.
 * Claimed lanes count as taken so two cars never merge into the same gap.
 */
export const laneFree = (c, lane, all) =>
  lane >= 0 && lane <= 2 &&
  all.every((o) => o === c || (Math.abs(o.lat - laneLat(lane)) > 2.4 && o.lane !== lane) || gap(c.s, o.s) < -20 || gap(c.s, o.s) > 35);

/** One driving step for an AI car (or the player on autopilot): `c` needs { s, lat, v, lane, cruise, latV }. */
export function drive(c, all, dt) {
  const lead = leader(c, c.lat, all);
  const target = lead.d < 90 ? Math.min(c.cruise, lead.v + (lead.d - 14) * 0.25) : c.cruise; // settle ~14 m behind
  c.v = Math.max(0, c.v + clamp(target - c.v, -8 * dt, 2 * dt));

  // Held up and settled in lane: try the passing lane (left) first, then right.
  if (lead.d < 45 && lead.v < c.cruise - 2 && Math.abs(c.lat - laneLat(c.lane)) < 0.1)
    c.lane = [c.lane - 1, c.lane + 1].find((lane) => laneFree(c, lane, all)) ?? c.lane;
  c.latV = clamp(laneLat(c.lane) - c.lat, -1, 1) * 1.2;
  c.lat += c.latV * dt;
  c.s = (c.s + c.v * dt) % LOOP;
}

/** `player` needs { s, lat, v }; it is treated as just another obstacle. */
export function updateTraffic(cars, player, dt) {
  const all = [...cars, player];
  for (const c of cars) drive(c, all, dt);
  for (const c of cars) recycle(c, player, all);
}

/** Cars are placed by their distance from the player, so near the Kaohsiung/Keelung seam they stay on the road around it. */
export function renderTraffic(cars, playerS) {
  for (const c of cars) {
    const s = playerS + gap(playerS, c.s), p = sample(s);
    c.root.position.copy(worldAt(s, c.lat));
    c.root.rotation.set(Math.atan(p.grade), -(p.th + Math.atan2(c.latV, Math.max(c.v, 1))), 0);
  }
}
