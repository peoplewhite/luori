# 落日

A tiny, cozy driving prototype: a sedan cruising an endless Taiwanese freeway loop with light traffic. Three.js + Vite, plain JS, installable PWA that works offline after the first load.

## Run

```bash
npm install
npm run dev        # http://localhost:5173 (also exposed on LAN for phone testing)
```

No HUD on screen, just small icons top-right that fade after a few idle seconds. A "tap to start" card (with the controls hint) comes first, because mobile browsers only play audio after a tap.

The camera icon saves the current frame as a PNG (share sheet on phones, so it can go to Photos; a download on desktop). Icons aren't in the picture.

The cup icon keeps the screen awake (Screen Wake Lock) while autopilot drives: on by default on desktop, off by default on phones to save battery; the choice is remembered. The fullscreen icon is hidden where the Fullscreen API is missing (iPhone Safari) and in the installed PWA, which is already full screen.

Sound is generated with Web Audio, no audio files: an engine hum and wind that follow the speed, plus crickets at night. The speaker icon mutes it (remembered).

Installed as a PWA (home screen), the touch buttons are hidden and autopilot is on by default unless the autopilot icon was switched off before; lane taps still work and a physical keyboard still takes over.

Landscape only: the manifest locks installed PWAs to landscape, and a portrait phone browser shows a "rotate your device" overlay.

Controls: `W/↑` throttle, `S/↓` brake (hold at standstill to reverse), `A D / ← →` steer. On touch devices on-screen buttons appear.

Simplest touch: tap the left / right half of the screen to move one lane left / right; this turns autopilot on and it drives the rest. A tap into a lane that isn't clear is ignored.

Scene modes (icons top-right, last choice saved in `localStorage`):

- **落日 (default)** – always sunset.
- **現實** – follows Taiwan time (UTC+8, whatever the device's time zone): night 18:00–05:59 with stars, street lamps and car lights, otherwise daylight. Checked every minute, so it flips live.

For testing real mode, `?t=day` or `?t=night` fakes the Taiwan clock.

Autopilot (steering-wheel icon, top-right) drives on its own with the same driver as the AI traffic: cruises at 100 km/h, follows, overtakes, takes the bends. Any key (modifier keys alone excepted) or the on-screen pad hands control back. It combines freely with either scene mode, and the touch buttons fade while it runs.

## Build

```bash
npm run build      # outputs dist/ with relative paths, deployable under any sub-path
npm run preview    # serve dist/ locally to test the PWA / offline mode
```

## Deploy

`dist/` is a static site; upload it to any static host, e.g.

```bash
npx netlify deploy --dir=dist --prod
npx vercel deploy dist --prod
npx gh-pages -d dist -t       # GitHub Pages (-t keeps dotfiles)
npx wrangler pages deploy dist  # Cloudflare Pages
```

Service workers need HTTPS (or `localhost`). When changing `public/sw.js` behaviour, bump `CACHE` in it.

## Layout

- `src/road.js` – closed-loop road curve (arc-length sampled), scenery, signs, street lamps, sky/mountains/stars
- `src/traffic.js` – low-poly sedan model, AI driver (car following + overtaking) used by traffic and autopilot
- `src/audio.js` – procedural engine / wind / cricket sounds
- `src/theme.js` – sunset / day / night palettes and the Taiwan-time rule
- `src/main.js` – player car, arcade driving model, collisions, chase camera, scene mode switch
- `public/` – manifest, service worker, icons
