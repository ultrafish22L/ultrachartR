# UltraChart Web v1.3.1

A modern financial charting application with astrological planet line overlays, built as a React web port of the legacy Windows C++/MFC UltraChart desktop application.

## What Is UltraChart?

UltraChart displays financial security data (stocks, futures, indices) as interactive candlestick/bar/line charts with zoom, scroll, and drawing tools. Its unique feature is **planet line overlays** -- astronomical planetary positions (computed via the Swiss Ephemeris) mapped onto the price axis, allowing users to visually correlate planetary cycles with market movements.

## Features

### Chart Rendering
- **Custom HTML5 Canvas 2D engine** -- no charting library, full control over rendering
- **Three chart styles**: Candlestick, Bar (OHLC), and Line
- **Volume bars** with toggle visibility
- **Auto-scaling** price axis to visible data range
- **Smooth zoom** (mouse wheel) and **pan** (click-drag)
- **Crosshair cursor** with price/time readout
- **Grid overlay** with intelligent tick spacing

### Drawing Tools
- **Trend Line** -- two-point line with optional extension
- **Horizontal Line** -- price level marker with label
- **Vertical Line** -- time marker with label
- **Rectangle** -- two-corner box with fill
- **Circle/Ellipse** -- center + radius with fill
- **Text Annotation** -- placed at any chart coordinate
- **Hit testing** -- click to select, Delete key to remove
- **Preview rendering** -- see the object as you place it

### Planet Lines (Swiss Ephemeris)
- **Swiss Ephemeris WASM** (`swisseph-wasm`) for high-precision planetary calculations directly in the browser
- **Equation-based fallback** using Keplerian orbital elements (~1 degree accuracy) if WASM fails
- **Configurable parameters**: planet, coordinate type (longitude/latitude/declination/right ascension), heliocentric vs geocentric, period, phase, amplitude
- **12 celestial bodies**: Sun, Moon, Mercury, Venus, Mars, Jupiter, Saturn, Uranus, Neptune, Pluto, North Node, Chiron
- **Visual options**: aspect vertical lines, aspect bands

### Market Data (TWS Bridge)
- **Interactive Brokers TWS** integration via Node proxy server (port 5050 → TWS 7496)
- **Symbol search** dialog with debounced contract lookup
- **Historical data** loading at multiple timeframes (intraday, daily, weekly, monthly)
- **Real-time streaming** via SSE (Server-Sent Events)
- **Cache system** for offline access to previously loaded data

### File Operations
- **Save** charts as `.uchart` JSON files (Ctrl+S) — saves to proxy server
- **Save As** with native file picker (Ctrl+Shift+S)
- **Open** saved charts with full state restoration (Ctrl+O)
- **Close All** charts (Ctrl+Shift+W)
- Serializes: security info, chart config, view state (zoom/scroll), drawing objects, planet lines

### MDI Workspace
- **Multiple charts** open simultaneously with tab switching
- **Layout modes**: Tabs (default), Cascade, Tile Horizontal, Tile Vertical
- **Workspace session** persistence — restores open charts on reload
- **Dirty tracking** with unsaved change indicators

### Application Shell
- **Menu bar**: File, Edit, Insert, Window, Help menus with keyboard shortcuts
- **Toolbar**: Drawing tools, astro tools, color/style/width/font selectors
- **Tab bar**: Chart tab switching and close buttons
- **Status bar**: OHLC readout, symbol, ephemeris backend, clock
- **3 themes**: Dark (default), Light, Vibe — switchable via Edit > Preferences

### Desktop App (Electron)
- **Standalone Windows application** — no browser required
- **Embedded proxy server** — Express server runs inside Electron's main process
- **Single-origin architecture** — all API routes and static files served from one port
- **Windows installer** — NSIS installer + portable exe via electron-builder

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | React 18 + TypeScript 5.6 |
| Build | Vite 6 |
| Rendering | Custom Canvas 2D engine |
| Ephemeris | `swisseph-wasm` (WASM) + equation fallback |
| Market Data | TWS bridge (Node + Express + @stoqey/ib, port 5050) |
| Desktop | Electron 33 + electron-builder (Windows) |
| State | React Context API + useReducer (WorkspaceContext + ChartContext) |
| Styling | CSS Modules + CSS Variables (3 themes: dark/light/vibe) |
| Serialization | JSON (.uchart files) |

## Project Structure

```
web/
├── src/
│   ├── App.tsx                        # Root component
│   ├── main.tsx                       # Entry point
│   ├── constants.ts                   # APP_NAME, APP_VERSION
│   ├── components/
│   │   ├── chart/                     # ChartPanel, ChartCanvas, ChartHeader, ChartFooter
│   │   ├── dialogs/                   # ImportDialog, PlanetLineDialog, PreferencesDialog, AboutDialog
│   │   └── layout/                    # AppLayout, MenuBar, AppToolbar, AppStatusBar, TabBar
│   ├── context/
│   │   ├── WorkspaceContext.tsx       # App-wide: charts, layout, drawing tools, streaming
│   │   └── ChartContext.tsx           # Per-chart: security, config, viewState, planetLines
│   ├── data/                          # Sample JSON data (ZS daily + 5-min)
│   ├── engine/
│   │   ├── ChartEngine.ts            # Core rendering coordinator
│   │   ├── Viewport.ts               # Zoom/pan/coordinate transforms
│   │   ├── TimeAxis.ts / PriceAxis.ts
│   │   ├── HitTester.ts              # Object click detection
│   │   ├── themeColors.ts            # Canvas theme from CSS variables
│   │   └── renderers/                # Candlestick, Grid, Volume, Object, Session renderers
│   ├── hooks/
│   │   ├── useChartEngine.ts         # Engine lifecycle + viewState restore
│   │   ├── useMarketData.ts          # Market data fetching
│   │   └── useRealtimeData.ts        # SSE streaming + cache sync
│   ├── planet/                        # EphemerisService, PlanetCalculator, PlanetRenderer
│   ├── services/
│   │   ├── FileService.ts            # .uchart save/load serialization
│   │   ├── IBService.ts              # TWS bridge REST client
│   │   ├── PreferencesService.ts     # localStorage preferences
│   │   └── WorkspaceSessionService.ts # Workspace session save/restore
│   ├── styles/                        # CSS variables (3 themes) + global reset
│   └── types/                         # chart, objects, planet, market types
├── electron/
│   ├── main.ts                        # Electron main process (embeds Express server)
│   └── preload.ts                     # Minimal preload script
├── proxy/
│   └── server.ts                      # TWS bridge + chart file I/O (embeddable for Electron)
├── public/                            # Static files + .uchart save location
├── dist/                              # Vite SPA build output
├── dist-electron/                     # Compiled Electron + proxy JS
├── index.html
├── package.json
├── tsconfig.json                      # Web app TypeScript config
├── tsconfig.electron.json             # Electron + proxy TypeScript config
├── electron-builder.yml               # Desktop app packaging config
└── vite.config.ts
```

## Legacy Codebase

The original UltraChart is a Windows C++ MFC application located at `legacy/code/appchart/`. Key legacy files that informed the web port:

| Legacy File | Purpose | Web Equivalent |
|-------------|---------|----------------|
| `chart.h/cpp` | Main chart (cChart, cTimeAxis, cFloatAxis) | `engine/ChartEngine.ts`, `Viewport.ts` |
| `chartplanet.h/cpp` | Planet line rendering (cChartPlanet) | `planet/PlanetRenderer.ts` |
| `ephem.h` | Swiss Ephemeris wrapper (cDllEphem) | `planet/EphemerisService.ts` |
| `chartobj.h/cpp` | Chart objects, handles | `objects/ObjectManager.ts`, `types/objects.ts` |
| `chartsam.h/cpp` | Sample (OHLCV) data management | `types/chart.ts`, `data/sampleData.ts` |
| `barchart.h/cpp` | Bar/candlestick rendering | `engine/renderers/CandlestickRenderer.ts` |

## License

Private project. All rights reserved.
