import * as THREE from 'three';

// Taiwan has no DST, so Asia/Taipei is always UTC+8 regardless of the device's own time zone.
const taipeiHour = (date = new Date()) => (date.getUTCHours() + 8) % 24;
const isNight = (hour) => hour >= 18 || hour < 6;

const dir = (x, y, z) => new THREE.Vector3(x, y, z).normalize();

const THEMES = {
  sunset: {
    night: false,
    sky: ['#ffd2a2', '#f2aaa2', '#7f90c8'], // horizon, mid, zenith
    fog: ['#f6caa6', 150, 1800],
    hemi: ['#dfe2f5', '#c4a887', 2.3],
    sun: ['#ffd6ad', 2.6],
    sunDir: dir(-0.35, 0.11, -1),
    discs: [[420, '#ffc48a', 0.35], [170, '#fff3d6', 1]], // radius, colour, opacity
    mtn: { colors: ['#c4b3cf', '#d0b6c2', '#b8adcc'], emissive: '#9a86a6', intensity: 0.45 },
  },
  day: {
    night: false,
    lamps: true,
    sky: ['#eef3ec', '#cde5ee', '#86b8e2'],
    fog: ['#e4ece8', 150, 1800],
    hemi: ['#eef2ff', '#bfb48e', 2.3],
    sun: ['#fff3e0', 2.8],
    sunDir: dir(-0.45, 0.8, -0.5),
    discs: [[420, '#fff8e6', 0.35], [150, '#fffdf6', 1]],
    mtn: { colors: ['#a9bfcd', '#b4c7c6', '#a0b4c8'], emissive: '#b8c9d4', intensity: 0.45 },
  },
  night: {
    night: true,
    lamps: true,
    sky: ['#3a3d70', '#212a5a', '#0c1234'],
    fog: ['#2c3263', 90, 1300],
    hemi: ['#7180c4', '#2b2838', 1.7],
    sun: ['#b8c4ff', 0.9], // moonlight
    sunDir: dir(0.3, 0.4, -1),
    discs: [[260, '#8f9ad0', 0.12], [80, '#f6f1dc', 1]],
    mtn: { colors: ['#3a416f', '#424676', '#353b68'], emissive: '#1f2550', intensity: 0.6 },
  },
};

/**
 * 'sunset' mode is always sunset; 'real' mode follows Taiwan's clock.
 * `?t=day` / `?t=night` fakes the Taiwan clock for testing real mode.
 */
export function themeFor(mode, search = location.search) {
  if (mode !== 'real') return THEMES.sunset;
  const t = new URLSearchParams(search).get('t');
  return THEMES[t === 'day' || t === 'night' ? t : isNight(taipeiHour()) ? 'night' : 'day'];
}
