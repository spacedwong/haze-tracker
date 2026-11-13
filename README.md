# Haze Tracker

A progressive web app showing live Singapore haze data from NEA (via data.gov.sg):

- **24-hour PSI** per region (north, west, central, east, south)
- **1-hour PM2.5** per region (NEA does not publish a 1-hour PSI)
- **Haze alerts**: choose a region (or "any") and a PSI threshold; get a notification when the 24-hour PSI reaches it

No build step, no backend. Serve the folder over HTTPS (e.g. GitHub Pages: Settings → Pages → Deploy from branch `main`, `/ (root)`) and open it on your phone.

## Install on a phone

- **Android (Chrome):** menu → Install app / Add to Home screen.
- **iPhone/iPad (Safari, iOS 16.4+):** Share → Add to Home Screen, then open it from the Home Screen.

## Alert limitations

Alerts are local notifications raised by the app itself (no push server):

- They fire while the app is open or recently active (it polls every 5 minutes).
- Chrome on Android can also check in the background (Periodic Background Sync) for installed apps; the browser decides how often.
- iOS cannot run background checks, so alerts there only fire while the app is open. Reliable closed-app alerts would need a small push server.

## Files

`index.html`, `styles.css`, `app.js` (UI) · `core.js` (API, PSI bands, alert logic) · `store.js` (IndexedDB) · `sw.js` (offline + background checks) · `manifest.webmanifest` · `icons/`
