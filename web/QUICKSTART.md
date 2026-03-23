# UltraChart Web v1.3.1 -- Quick Start Guide

## Prerequisites

- **Node.js** 18+ and npm
- **Interactive Brokers TWS** (optional, for live market data)

## Installation

```bash
cd ultrachart/web
npm install
```

## Running (Web Dev Server)

```bash
npm run dev
```

The app starts at **http://127.0.0.1:3000**. Use F2/F3 to load sample data without TWS.

> The dev server must bind to `127.0.0.1` (not `localhost`) for the preview tools to work. This is configured in `vite.config.ts`.

## Running (Desktop App)

```bash
npm run electron:dev
```

This builds the SPA, compiles the Electron main process, and launches the desktop window. The Express proxy server runs embedded inside Electron — no separate server needed.

## Building the Desktop Installer

```bash
npm run electron:build
```

Output goes to `release/`. Produces a Windows NSIS installer and a portable `.exe`.

## Using the App

### Navigation
- **Zoom**: Mouse wheel (scroll up to zoom in, down to zoom out)
- **Pan**: Click and drag on the chart
- **Crosshair**: Moves with the mouse cursor (toggle with X key)

### Chart Styles
Use the per-chart header dropdown to switch between:
- Bar (OHLC, default)
- Candlestick
- Line (close only)

### Drawing Objects
1. Click a tool in the **DRAW** section of the toolbar (Line, Horizontal, Vertical, Rectangle, Circle, or Text)
2. Click on the chart to place the first point
3. For two-point objects (Line, Rectangle, Circle), click again to complete
4. Press **Escape** to cancel, **Delete** to remove a selected object
5. Click on an existing object to select it

### Planet Lines
1. Click the planet icon in the **ASTRO** section of the toolbar, or use **Insert > Planet Line...**
2. Configure the planet, coordinate system, and mapping parameters:
   - **Planet**: Sun, Moon, Mercury, Venus, Mars, Jupiter, Saturn, Uranus, Neptune, Pluto, North Node, Chiron
   - **Perspective**: Heliocentric or Geocentric
   - **Coordinate**: Longitude, Latitude, Declination, Right Ascension
   - **Period**: Angular degrees per price cycle
   - **Phase**: Offset in degrees
   - **Amplitude**: Price range of the wave
3. Click **Add** to overlay the planet line on the chart
4. Multiple planet lines can be added simultaneously

The status bar shows which ephemeris backend is active:
- **SwissEph** -- Swiss Ephemeris WASM (high precision)
- **Equations** -- Keplerian equation fallback (~1 deg accuracy)

### File Operations
- **Ctrl+S** or File > Save -- Saves the chart as a `.uchart` JSON file
- **Ctrl+Shift+S** or File > Save As... -- Save with file picker
- **Ctrl+O** or File > Open Chart -- Opens a previously saved `.uchart` file
- **Ctrl+L** or File > Import Security -- Opens the TWS symbol search dialog
- **Ctrl+Shift+W** or File > Close All Charts -- Closes all open charts

### Keyboard Shortcuts
| Action | Shortcut |
|--------|----------|
| Import Security | Ctrl+L |
| Open Chart | Ctrl+O |
| Save | Ctrl+S |
| Save As | Ctrl+Shift+S |
| Close All Charts | Ctrl+Shift+W |
| Preferences | Ctrl+P |
| Copy Object | Ctrl+C |
| Paste Object | Ctrl+V |
| Delete Object | Delete |
| Toggle Time Mode | T |
| Toggle Volume | V |
| Toggle Grid | G |
| Toggle Crosshair | X |
| Toggle Session Bands | B |
| Toggle Timeline Style | L |
| Ephemeris Wheel | E |
| Load Sample (Daily) | F2 |
| Load Sample (5-min) | F3 |
| Quick Load Test | F5 |

## Connecting to Interactive Brokers (Optional)

To load live market data, you need TWS (Trader Workstation) running and the proxy bridge server.

### 1. Start TWS

Run IB Trader Workstation with API connections enabled on port 7496 (default).

### 2. Start the TWS Bridge

For the web dev server, start the proxy separately:

```bash
cd proxy
npm start
```

The bridge runs on port 5050 and connects to TWS. If TWS is not running, the bridge still starts — chart file save/load works, but live data features will not.

For the **desktop app** (`npm run electron:dev`), the proxy is embedded — no separate start needed.

### 3. Use the App

1. **Ctrl+L** or File > Import Security
2. Type a symbol (e.g., "ZS", "ES", "EURUSD")
3. Select a contract from the search results
4. Historical data loads into the chart
5. Click **LIVE** in the menu bar to start real-time streaming

## Building

### Web (SPA only)
```bash
npm run build
```
Output: `dist/` — static SPA with Swiss Ephemeris WASM.

### Desktop (Windows installer)
```bash
npm run electron:build
```
Output: `release/` — Windows NSIS installer + portable exe. Includes the embedded proxy server.

## Troubleshooting

### Swiss Ephemeris WASM fails to load
- The `swisseph-wasm` package must be excluded from Vite's dependency optimizer. This is configured in `vite.config.ts`:
  ```ts
  optimizeDeps: { exclude: ['swisseph-wasm'] }
  ```
- If WASM fails to load, the app falls back to equation-based calculations automatically. Check the status bar for "Equations" vs "SwissEph".

### IB API Connection Issues
- Ensure TWS is running with API enabled on port 7496
- Ensure the proxy bridge is running (`cd proxy && npm start` for web, or automatic in desktop app)
- Check the bridge console for connection errors
- The LIVE button in the menu bar shows connection status

### Chart Looks Empty
- The app loads sample data on startup. If no chart appears, check the browser console for errors.
- Try a hard refresh (Ctrl+Shift+R) to clear any stale HMR state.

### React Hook Order Error After HMR
- If you see "Rendered more hooks than during the previous render" during development, restart the dev server. This is a known Vite HMR limitation when hook counts change.
