# Front Seat

A single-purpose iPhone web app that decides who gets the front seat. Tap **Spin**, watch the roulette wheel for ~10 seconds, and the ball lands on **Heidi** (light blue) or **Hanne** (light pink).

- Plain HTML/CSS/JS, no build step, no libraries, no network calls after the first load.
- Fair 50/50 using `crypto.getRandomValues`, with one guard: if the same person has won 4 in a row, the next spin goes to the other person. The last 4 results live in `localStorage` and are never shown.
- Works offline via a service worker; installable to the home screen.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page shell, iOS home-screen meta tags, service worker registration |
| `styles.css` | Layout, light/dark themes, result overlay |
| `app.js` | Wheel rendering, spin animation, streak rule, result overlay |
| `sw.js` | Precaches every file, serves cache-first, cleans up old caches |
| `manifest.webmanifest` | PWA name, icons, standalone/portrait |
| `icons/` | Home-screen icons (180, 192, 512, 512 maskable) |

## Deploy (GitHub Pages)

1. Push to GitHub.
2. Repo **Settings → Pages → Build and deployment**: set Source to **GitHub Actions**. The workflow in `.github/workflows/pages.yml` then publishes the app on every push to `master` (it can also be run by hand from the Actions tab).
3. After a minute the app is live at `https://karlehr.github.io/hello-world/`.

### Shipping an update

Bump `CACHE_VERSION` in `sw.js` (e.g. `'v1'` → `'v2'`) in the same commit as your changes. Installed copies pick up the new version the next time they're opened online; it may take a second launch to show.

## Install on iPhone

1. Open the Pages URL in **Safari** (not Chrome — iOS only installs web apps from Safari).
2. Tap **Share → Add to Home Screen → Add**.
3. Launch from the new icon: it should open full-screen with no Safari bars.
4. Turn on airplane mode and relaunch: it should still work.

Sound: the wheel ticks via Web Audio, so it follows the ring/silent switch. iPhone ignores vibration for web apps.

## Hidden test menu

Tap the **Front Seat** title 5 times quickly. It logs the last 4 results to the console and offers to reset them (handy for checking the 4-in-a-row rule).

## Local testing

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

Service workers need HTTPS or `localhost`, so testing from the phone over your LAN needs HTTPS (e.g. `mkcert` + a static server, with the mkcert root CA installed on the iPhone). GitHub Pages is the simpler route.
