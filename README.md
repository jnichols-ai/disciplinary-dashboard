# Disciplinary Action Dashboard

A PWA that pulls live data from the **Disciplinary Action Tracker** board on monday.com, with filtering by branch, manager, write-up type, employee, status, violation category, date range, and repeat offenses.

## Setup

1. Install Node.js if you don't have it (any version 18+).
2. In this folder, run:
   ```
   npm install
   npm start
   ```
3. Open `http://localhost:3000` in Chrome or Edge.
4. Click the gear icon and paste a monday.com personal API token (Avatar → Admin → API → Generate). The token is stored only in your browser (localStorage) and is sent only to your own local server, which relays it to monday.com — it's never saved on disk.
5. Click **Install App** in the top bar (or use your browser's "Install" / "Add to Home Screen" option) to use it like a native app on desktop or mobile.

A monday.com API call can't be made directly from a browser (monday's API doesn't allow cross-origin requests), so `server.js` runs a tiny local proxy that relays requests — this is why the app needs `npm start` rather than just opening `index.html` directly.

## Notes on the data

- The board doesn't currently have a dedicated "Employee Name" field — names are parsed from the item title (e.g. "Frank the Tank — Written Warning (Josh Emerson)"). If you add a real Employee Name column down the line, the employee filter will get more reliable; for now it falls back to whatever text comes before the dash.
- Branch and Region filters populate from whatever values already exist on the board.
- Write-up Type and Status filters use the board's existing label sets (Verbal Warning → Termination, Draft → Closed).

## Deploying with Git + Vercel

This project is set up to deploy on Vercel with zero config:

- `index.html`, `styles.css`, `app.js`, `manifest.json`, `icons/` are served as static files.
- `api/monday.js` is a Vercel Serverless Function that does the same CORS-proxy job as `server.js` does locally — Vercel auto-detects anything in `/api` as a function, no build step needed.
- `server.js` is only used for local development (`npm start`); Vercel ignores it.

To deploy:

1. Push this folder to a GitHub (or GitLab/Bitbucket) repo:
   ```
   git init
   git add .
   git commit -m "Disciplinary Action Dashboard"
   git remote add origin <your-repo-url>
   git push -u origin main
   ```
2. Go to vercel.com → **Add New Project** → import that repo. Leave the framework preset as "Other" — no build command or output directory is needed.
3. Deploy. Vercel gives you a `https://<project>.vercel.app` URL.
4. Open that URL, click the gear icon, paste your monday.com personal API token, and sync. The token still only lives in the browser's localStorage — Vercel's function just relays the request, the same as the local proxy does.
5. Anyone with the link can install it as a PWA from their phone or desktop browser. Each person enters their own monday.com token, so access still follows your monday.com permissions.

Once it's on a real HTTPS URL, the "Install App" prompt and offline shell caching (service worker) work the same way they do locally — those features need HTTPS or localhost, which Vercel provides automatically.
