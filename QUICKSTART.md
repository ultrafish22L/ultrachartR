# Quick Start

## Prerequisites

- **Node.js 18+** and npm
- **Python 3.11+** (only if using the astro engine)
- **IB Trader Workstation** (only if you want live market data)

## Install

```bash
# Web app
cd web
npm install

# Proxy / TWS bridge (separate package)
cd proxy
npm install
cd ..
```

For the Python astro engine (optional):

```bash
cd astro-engine
pip install -e .
```

## Run — Web Development

Start the proxy and dev server in two terminals:

```bash
# Terminal 1: TWS bridge + API server
cd web/proxy
npm start                    # listens on :5050

# Terminal 2: Vite dev server
cd web
npm run dev                  # opens http://127.0.0.1:3000
```

The app loads sample soybean futures data on startup. No TWS connection needed to explore the UI.

## Run — Electron Desktop (All-in-One)

The Electron app embeds the proxy server so only one process is needed:

```bash
cd web
npm run electron:dev         # dev mode with hot reload
```

To build a Windows installer:

```bash
cd web
npm run electron:build       # outputs to release/
```

This produces an NSIS installer and a portable `.exe`.

## Connect to Interactive Brokers (Optional)

1. Open IB Trader Workstation (or IB Gateway)
2. Enable the API: **File > Global Configuration > API > Settings**
   - Check "Enable ActiveX and Socket Clients"
   - Socket port: **7496** (default)
   - Uncheck "Read-Only API" if you want full access
3. The proxy auto-connects on startup. Check status at `http://127.0.0.1:5050/status`

Environment variables (all optional):

```bash
TWS_HOST=127.0.0.1          # default
TWS_PORT=7496                # default
BRIDGE_PORT=5050             # default
CLIENT_ID=99                 # must be unique per app instance
```

## Using the App

### Load a Chart

- **Ctrl+L** — Open symbol search (requires TWS connection)
- **Ctrl+O** — Open a saved `.uchart` file
- Sample data loads automatically on first launch

### Navigate

- **Mouse wheel** — Zoom in/out
- **Click + drag** — Pan left/right
- **X** — Toggle crosshair

### Drawing Tools

Select a tool from the toolbar, click on the chart to place points. Click an existing object to select it, press **Delete** to remove.

### Planet Lines

Open the planet lines panel to add celestial body overlays. Configure body, coordinate system (longitude/latitude/declination/RA), and perspective (geo/helio).

### Save Your Work

- **Ctrl+S** — Save current chart
- **Ctrl+Shift+S** — Save as new file

### Workspace

- **Tabs** at the top to switch between open charts
- **Layout menu** — Switch between tabs, cascade, tile horizontal, tile vertical
- Session auto-restores on reload (configurable in preferences)

### Themes

Three themes available in preferences: **Dark**, **Light**, **Vibe**.

## Troubleshooting

**"TWS not connected"** — Make sure Trader Workstation is running with the API enabled on port 7496. The proxy retries on startup but won't block if TWS is unavailable.

**Blank chart on load** — Check the browser console. If you see CORS errors, make sure you're running both the Vite dev server (`:3000`) and proxy (`:5050`). In Electron mode this isn't needed since both run in one process.

**Planet lines not rendering** — The Swiss Ephemeris WASM module takes a few seconds to initialize on first use. If it fails, the app falls back to Keplerian equations (~1 degree accuracy). Check the console for "Ephemeris backend" messages.

**Electron build fails** — Run `npm run build` first to generate the Vite output in `dist/`, then `npm run electron:build`.
