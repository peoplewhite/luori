# 落日

A tiny, cozy driving prototype: a sedan cruising the real Taiwan National Freeway 1 (中山高) southbound, Keelung to Kaohsiung, with light traffic. Three.js + Vite, plain JS, installable PWA that works offline after the first load.

## Run

```bash
npm install
npm run dev        # http://localhost:5173 (also exposed on LAN for phone testing)
```

No HUD on screen, just small icons top-right that fade after a few idle seconds. A "tap to start" card (with the controls hint) comes first, because mobile browsers only play audio after a tap.

The camera icon saves the current frame as a PNG (share sheet on phones, so it can go to Photos; a download on desktop). Icons aren't in the picture.

The cup icon keeps the screen awake (Screen Wake Lock) while autopilot drives: on by default on desktop, off by default on phones to save battery; the choice is remembered. The fullscreen icon is hidden where the Fullscreen API is missing (iPhone Safari) and in the installed PWA, which is already full screen.

Sound: a low engine hum generated with Web Audio that follows the speed. After a minute of driving, a lofi track fades in (looped) and its title / artist fade in top-left for a few seconds. The speaker icon mutes both (remembered).

Installed as a PWA (home screen), the touch buttons are hidden and autopilot is on by default unless the autopilot icon was switched off before; lane taps still work and a physical keyboard still takes over.

Landscape only: the manifest locks installed PWAs to landscape, and a portrait phone browser shows a "rotate your device" overlay.

Controls: `W/↑` throttle, `S/↓` brake (hold at standstill to reverse), `A D / ← →` steer. On touch devices on-screen buttons appear.

Simplest touch: tap the left / right half of the screen to move one lane left / right; this turns autopilot on and it drives the rest. A tap into a lane that isn't clear is ignored.

Scene modes (icons top-right, last choice saved in `localStorage`):

- **落日 (default)** – always sunset.
- **現實** – follows Taiwan time (UTC+8, whatever the device's time zone): night 18:00–05:59 with stars, street lamps and car lights, otherwise daylight. Checked every minute, so it flips live.

For testing real mode, `?t=day` or `?t=night` fakes the Taiwan clock.

The route: National Freeway 1 southbound at real scale, 375.5 km from the Keelung end to Kaohsiung, with real bends and (smoothed) real hills. Speeds are real too: 110 km/h flat out by hand, autopilot cruises at 100 km/h (OSM tags 205 km of the route at a 110 limit, 168 km at 100), so a bend takes as long as it would in a real car at that speed. Full throttle all the way is ~3 h 25 min, autopilot ~3 h 45 min. After Kaohsiung the screen fades into the haze and you come back in at Keelung. Each load starts at Keelung. Kept simple: always three lanes and the same roadside (no interchanges, bridges, tunnels or towns), the small km posts count from the start of the OSM line, and autopilot doesn't follow the posted limits.

Autopilot (steering-wheel icon, top-right) drives on its own with the same driver as the AI traffic: cruises at 100 km/h, follows, overtakes, takes the bends. Any key (modifier keys alone excepted) or the on-screen pad hands control back. It combines freely with either scene mode, and the touch buttons fade while it runs.

## Build

```bash
npm run build      # outputs dist/ with relative paths, deployable under any sub-path
npm run preview    # serve dist/ locally to test the PWA / offline mode
```

## Route data

`public/freeway1.bin` is baked once, not fetched by players:

```bash
node scripts/bake-route.mjs [overpass.json] [elevation.json]   # optional caches, see the script header
```

It takes OSM relation [3745870](https://www.openstreetmap.org/relation/3745870) (中山高速公路 南向), chains its 641 ways, projects to metres, resamples every 2 m, smooths the centreline (60 m Gaussian, OSM draws bends as straight pieces ~90 m apart) and stores heading, curvature and elevation as three Float32 columns (2.25 MB). Elevation is SRTM 30 m from the public OpenTopoData API, smoothed over 600 m (SRTM is the ground, not the bridge deck); steepest grade 5.9%. The game integrates x / z from the heading at load.

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

- `src/road.js` – Freeway 1 route from `public/freeway1.bin` (arc-length sampled), scenery built in 400 m chunks around the player, signs, street lamps, sky/mountains/stars
- `scripts/bake-route.mjs` – bakes `public/freeway1.bin` from OpenStreetMap + SRTM
- `src/traffic.js` – low-poly sedan model, AI driver (car following + overtaking) used by traffic and autopilot; traffic lives in a window around the player
- `src/audio.js` – synthesised engine hum, background music
- `src/theme.js` – sunset / day / night palettes and the Taiwan-time rule
- `src/main.js` – player car, arcade driving model, collisions, chase camera, scene mode switch
- `public/` – manifest, service worker, icons, route data, music

## Credits

Route: map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/). `public/freeway1.bin` is derived from it and is likewise licensed under the ODbL 1.0 (rebuild it with `scripts/bake-route.mjs`). The game shows the credit at the bottom of the screen.

Elevation: SRTM 1 arc-second (NASA / USGS, public domain), queried through [OpenTopoData](https://www.opentopodata.org/).

Background music: "Chill Lofi Inspired" by omfgdude, [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (public domain), from [OpenGameArt](https://opengameart.org/content/chill-lofi-inspired). Shipped unmodified as `public/chill-lofi.mp3`. CC0 needs no attribution; it's credited here anyway.
