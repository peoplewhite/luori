# 落日

A tiny, cozy driving prototype: a sedan cruising an endless Taiwanese freeway loop at sunset, with light traffic. Three.js + Vite, plain JS, installable PWA that works offline after the first load.

## Run

```bash
npm install
npm run dev        # http://localhost:5173 (also exposed on LAN for phone testing)
```

Controls: `W/↑` throttle, `S/↓` brake (hold at standstill to reverse), `A D / ← →` steer. On touch devices on-screen buttons appear.

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
npx gh-pages -d dist          # GitHub Pages
npx wrangler pages deploy dist  # Cloudflare Pages
```

Service workers need HTTPS (or `localhost`). When changing `public/sw.js` behaviour, bump `CACHE` in it.

## Layout

- `src/road.js` – closed-loop road curve (arc-length sampled), scenery, signs, sky/mountains
- `src/traffic.js` – low-poly sedan model, AI traffic (car following + overtaking)
- `src/main.js` – player car, arcade driving model, collisions, chase camera, HUD
- `public/` – manifest, service worker, icons
