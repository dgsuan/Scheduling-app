# campus-schedule-app

A minimal scaffold for a cross-platform (iOS + Android) student schedule
app, inspired by UP Diliman's Folderly/UVLE. See [ARCHITECTURE.md](./ARCHITECTURE.md)
for the framework choice, backend/database recommendation, and feature
roadmap. This scaffold has 4 placeholder screens with navigation between
them, and **no backend, database, or real feature logic yet**.

## A note on Expo SDK version

This project is pinned to **Expo SDK 54**, not the newest SDK, on purpose:
as of mid-2026 Apple has a long-running backlog approving new Expo Go
builds, so the Expo Go app on the App Store has been stuck on SDK 54 for
months. Pinning here means Expo Go on a real iPhone will actually open
this project. If you're only testing on an Android emulator or don't need
Expo Go, you can upgrade later with `npx expo install expo@latest && npx
expo install --fix`.

## Prerequisites

- [Node.js](https://nodejs.org) 20+ and npm
- To run on **iOS**: a Mac with Xcode installed (for the iOS Simulator)
- To run on **Android**: [Android Studio](https://developer.android.com/studio)
  with an Android Virtual Device (emulator) set up
- Alternatively, install the free **Expo Go** app on a real iPhone or
  Android phone — no Xcode/Android Studio needed to try it out

## Run it

```bash
npm install   # first time only
npx expo start
```

This starts one dev server for both platforms. From there, press:

- `i` to open in the iOS Simulator
- `a` to open in the Android Emulator
- or scan the QR code with the Expo Go app on your phone

`npm run ios` / `npm run android` do the same thing directly. Press `w`
(or run `npm run web`) to open it in a browser.

## Run it on the web / host on GitHub Pages

The same codebase also builds to a static website via `react-native-web`.

```bash
npm run export:web   # outputs a static site to ./dist
```

`dist/` is a plain folder of HTML/JS/CSS you can host anywhere static.

**GitHub Pages is already wired up.** [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)
(at the repo root) builds this app and publishes `dist/` on every push to
`main`. To turn it on once:

1. On GitHub: **Settings → Pages → Build and deployment → Source: GitHub
   Actions**.
2. Push to `main` (or run the "Deploy web to GitHub Pages" workflow
   manually from the Actions tab).
3. The site goes live at **https://dgsuan.github.io/Scheduling-app/**.

Notes:

- `app.json` sets `experiments.baseUrl` to `/Scheduling-app` because a
  GitHub Pages *project* site is served from that sub-path. If you rename
  the repo or move to a custom domain / user site (served from `/`),
  update or remove that value.
- `web.output` is `"single"` (a single-page app). The workflow copies
  `index.html` to `404.html` so a hard refresh on any route still loads.
- `public/.nojekyll` keeps GitHub Pages from hiding Expo's `_expo/` folder.
- All data still lives in the browser (via `localStorage`) — there is no
  backend, and nothing is shared between visitors or devices.

## What's here

Four tabs, each a placeholder screen matching the concept mockups:

- **Schedule** — dark home screen with "No Ongoing Class" / "Next Class"
- **Calendar** — month grid + export panel (events to export, time range)
- **Notes** — blank freeform canvas
- **Import** — import-from-LMS panel

None of these screens read or write real data yet — see ARCHITECTURE.md's
roadmap for what's next.
