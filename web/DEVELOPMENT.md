# UltraChart Web v1.3.1 -- Development Guide & Roadmap

This document serves as institutional memory for the UltraChart web project. It captures architecture decisions, implementation status, known issues, and the roadmap for future work.

---

## Architecture Overview

### Rendering Pipeline

The chart uses a **render-on-demand** pattern (not a continuous animation loop). `requestAnimationFrame` is called only when state changes (zoom, pan, data update, object edit).

```
ChartEngine.render()
  1. GridRenderer.drawBackground()      -- grid lines, axes
  2. TimeAxis / PriceAxis               -- axis labels and ticks
  3. VolumeRenderer.draw()              -- volume bars (bottom section)
  4. CandlestickRenderer.draw()         -- OHLC candles/bars/line
  5. PlanetRenderer.draw()              -- planet line overlays
  6. ObjectRenderer.draw()              -- drawing objects (lines, shapes, text)
  7. ObjectRenderer.drawPreview()       -- in-progress drawing tool preview
  8. Price marker                       -- current price label on Y axis
  9. GridRenderer.drawCrosshair()       -- crosshair cursor
```

### State Management

```
WorkspaceContext (app-wide, React Context + useReducer)
  ├── state.charts[]       -- ChartInstance[] (open charts with config/security/viewState)
  ├── state.activeChartId  -- Current focused chart
  ├── state.layout         -- 'tabs' | 'cascade' | 'tile-h' | 'tile-v'
  ├── drawingTool          -- DrawingTool (active tool or null)
  ├── drawingObjectStyle   -- { color, lineWidth, lineStyle, fontFamily }
  └── engineRegistryRef    -- Map<chartId, ChartEngine> (for save/load access)

ChartContext (per-chart, React Context + useReducer)
  ├── state.security       -- SecurityData (bars, symbol, period)
  ├── state.config         -- ChartConfig (style, grid, crosshair, volume)
  ├── state.viewState      -- ViewState (scrollOffset, pixelsPerBar, priceRange)
  ├── state.mouse          -- ChartMouseState (position, price, bar index)
  └── planetLines          -- PlanetLineObject[] (planet overlays)
```

The ChartEngine is **imperative** -- it owns the Canvas context and renders directly. React state flows one-way into the engine via `useChartEngine` hook effects. The engine does NOT trigger React re-renders (except mouse state updates for the status bar).

### Coordinate System

- **World coordinates**: `x` = Unix timestamp (ms), `y` = price
- **Pixel coordinates**: `x` = pixels from left, `y` = pixels from top (Canvas convention)
- **Bar index**: Integer position in the `bars[]` array

The `Viewport` class handles all transforms:
- `barToX(barIndex)` / `findBarIndex(pixelX)` -- bar index to/from pixel X
- `priceToY(price)` / `yToPrice(pixelY)` -- price to/from pixel Y
- `worldToPixel(point)` / `pixelToWorld(point)` -- full transforms

### Drawing Tool State Machine

```
null (pointer/pan mode)
  │
  ├── User selects tool → tool = 'line' | 'rectangle' | 'circle' | ...
  │
  ├── Single-click tools (horizontalLine, verticalLine, text):
  │     click → create object → tool = null
  │
  └── Two-click tools (line, rectangle, circle):
        click → store anchor point, show preview
        mousemove → update preview rendering
        click → create object → tool = null
        Escape → cancel → tool = null
```

---

## Implementation Status

### Phase 1: Chart Rendering -- COMPLETE
- [x] Vite + React + TypeScript project scaffolding
- [x] Custom Canvas 2D ChartEngine
- [x] Candlestick, Bar, and Line chart styles
- [x] Volume bars with configurable height ratio
- [x] Price axis with auto-scaling and smart tick intervals
- [x] Time axis with date/time labels
- [x] Grid overlay
- [x] Mouse wheel zoom (centered on cursor)
- [x] Click-drag panning
- [x] Crosshair cursor with price/time readout
- [x] CSS Variables dark theme
- [x] Sample data generator (random walk with upward bias)

### Phase 2: App Shell -- COMPLETE
- [x] AppLayout with grid-based layout (menubar / toolbar / chart / statusbar)
- [x] MenuBar with File, Edit, Insert, View dropdown menus
- [x] Toolbar with chart style toggles, volume toggle, drawing tools, planet line button
- [x] StatusBar showing symbol, name, period, ephemeris backend

### Phase 3: Drawing Objects -- COMPLETE
- [x] Type system: ChartObjectBase with Line, HLine, VLine, Rectangle, Circle, Text types
- [x] ObjectManager: CRUD, selection, serialization
- [x] ObjectRenderer: renders all object types with selection handles
- [x] HitTester: point-to-object distance for click detection
- [x] Drawing tool state machine in ChartEngine
- [x] Preview rendering during two-click placement
- [x] Keyboard handling: Delete to remove, Escape to cancel

### Phase 4: IB API Integration -- COMPLETE
- [x] Vite dev server proxy (`/ib` → Express proxy on port 5050 → TWS on port 7496)
- [x] IBService REST client (auth, search, history, snapshot)
- [x] Market data types (IBContract, IBHistoryResponse, etc.)
- [x] SymbolSearch dialog with debounced search
- [x] useMarketData hook for loading security data

### Phase 5: Planet Lines -- COMPLETE
- [x] Swiss Ephemeris WASM integration (`swisseph-wasm` package)
- [x] Equation-based fallback (Keplerian orbital elements)
- [x] Dual-backend EphemerisService with automatic fallback
- [x] PlanetCalculator: maps planetary longitude/declination to price coordinates
- [x] PlanetRenderer: draws planet lines on canvas with clipping
- [x] PlanetLineDialog: full configuration UI
- [x] 12 celestial bodies supported
- [x] Status bar shows active backend (SwissEph / Equations)
- [x] `optimizeDeps.exclude` for swisseph-wasm WASM loading

### Phase 6: File Save/Load -- COMPLETE
- [x] FileService with ChartFile format (version 1)
- [x] serializeChart / deserializeChart
- [x] Browser file download (downloadFile)
- [x] Browser file picker (openFile)
- [x] Save/load wired into AppLayout and MenuBar
- [x] Keyboard shortcuts: Ctrl+S (save), Ctrl+O (open), Ctrl+L (symbol search)
- [x] Engine ref registration in ChartContext for object access

### Phase 7: MDI Workspace -- COMPLETE
- [x] Multi-chart workspace with tabs, cascade, tile-h, tile-v layouts
- [x] WorkspaceContext: charts[], activeChartId, layout management
- [x] TabBar with chart switching and close buttons
- [x] ChartHeader per-chart with title, style, controls

### Phase 8: Preferences & Persistence -- COMPLETE
- [x] PreferencesService: theme, ephemerisBackend, restoreWorkspace (localStorage)
- [x] WorkspaceSessionService: save/restore open charts on reload
- [x] Dirty tracking with asterisk in tab, confirm on close, beforeunload warning
- [x] 3 themes: Dark (default), Light, Vibe

### Phase 9: Save/Load Improvements -- COMPLETE
- [x] ViewState (zoom/scroll) persists through save/load cycle
- [x] viewState flows through component tree: addChart → ChartProvider → useChartEngine
- [x] Proxy-based chart file I/O: POST /chart/save, GET /chart/load (public/ folder)
- [x] Proxy server starts HTTP listener before TWS (chart endpoints work without TWS)
- [x] File > Close All Charts (Ctrl+Shift+W)
- [x] F5 quick-load for testing
- [x] Save As with file handle for silent re-saves

### Phase 10: Code Cleanup -- COMPLETE
- [x] Dead code removal, shared utilities, desktop-ready proxy routing

### Phase 11: UI Polish -- COMPLETE
- [x] Uniform 22px buttons, red close buttons, toolbar reorder
- [x] Margin drag from last bar, ephemeris icons, chart defaults persistence

### Phase 12: Edit Menu, Planet Line Fix, Desktop App -- COMPLETE
- [x] Edit menu: Delete/Copy/Paste with single code path (keyboard + menu call same engine methods)
- [x] Removed Undo/Redo/Select All from Edit menu
- [x] Planet line delete persistence fix (`onPlanetLineDeleted` callback wiring)
- [x] Electron desktop app: embedded Express server, BrowserWindow, static SPA serving
- [x] `/ib` prefix rewrite middleware for same-origin API calls in Electron
- [x] Proxy server refactored to export `startServer()` / `connectToTWS()` for embedding
- [x] electron-builder config for Windows (NSIS installer + portable)
- [x] `npm run electron:dev` and `npm run electron:build` scripts

### Phase 13: Code Review Fixes -- COMPLETE
- [x] Fixed context menu event listener leak in `ChartEngine.dispose()`
- [x] Replaced `window.prompt()` with React `TextInputDialog` for text annotations
- [x] Fixed `openFile()` AbortError when user cancels file picker
- [x] Deduplicated `distToSegment` to shared `utils/geometry.ts`
- [x] Added runtime validation to `ObjectManager.fromJSON()` with `isValidChartObject()` type guard
- [x] Fixed `engineRef.current` in useEffect deps — added `engineVersion` counter pattern to ChartContext
- [x] Moved ephemeris wheel button to Astro group with SVG icon
- [x] Code review documented in `docs/code-review.md` (8.2/10)
- [x] Architectural debt documented in `docs/architectural-debt.md`

---

## Key Technical Decisions

### Why Custom Canvas 2D (No Charting Library)?
The planet line overlay requires precise control over rendering order, coordinate transforms, and custom drawing that charting libraries (Chart.js, Recharts, TradingView) don't support well. A custom engine also mirrors the legacy C++ MFC architecture, making the port more straightforward.

### Why React Context Instead of Redux/Zustand?
The app uses Context + useReducer at two levels: WorkspaceContext (app-wide) and ChartContext (per-chart). This provides sufficient state management without the overhead of an external library. The imperative ChartEngine handles most of the complex state (viewport, objects) internally. See `docs/architectural-debt.md` for analysis of the dual-state trade-offs.

### Why Dual Ephemeris Backend?
Swiss Ephemeris WASM provides arc-second precision but depends on WASM loading successfully. The Keplerian equation fallback (using mean orbital elements + Kepler equation solver) provides ~1 degree accuracy, which is sufficient for visualization purposes and ensures the app always works.

### Why Vite Proxy + Express Server?
In dev mode, Vite proxies `/ib/*` and `/chart/*` to the Express proxy server on port 5050 (which connects to TWS via `@stoqey/ib`). For the Electron desktop app, the same Express server is embedded directly in the main process, serving both the SPA static files and API routes from one origin. The `/ib` prefix rewrite middleware in server.ts ensures the same frontend code works in both modes without changes.

### File Format (.uchart)
Charts are saved as JSON with a version number for forward compatibility. Planet line samples are NOT saved (they're recomputed from config on load). OHLCV bar data is NOT saved (it's reloaded from IB using the saved symbol/period).

---

## Known Issues & Limitations

1. **No object dragging/resizing** -- Objects can be selected and deleted but not moved or resized interactively. The HitTester supports handle detection, but the drag-to-move logic is not yet implemented.

2. **No undo/redo** -- Would require a command pattern or state snapshot system.

3. **No property editor** -- Selected objects can't have their properties (color, width, etc.) edited through a UI panel after creation.

4. **No object list sidebar** -- There's no panel showing all chart objects with visibility toggles.

5. **Planet line dialog: no editing** -- Planet lines can be added and removed but not edited after creation. A right-click context menu or property panel would be needed.

6. **Electron tsc type warnings** -- The proxy server.ts shows 4 type warnings from `@stoqey/ib` type definitions when compiled with `tsconfig.electron.json`. These are harmless — files emit correctly.

7. **Architectural debt** -- Dual state (React ↔ Engine) and god component (AppLayout.tsx ~1045 lines). See `docs/architectural-debt.md` for analysis and recommended decomposition.

---

## Roadmap: Future Enhancements

### Priority 1: Polish Existing Features
- [ ] **Object drag/resize**: Implement handle dragging in ChartEngine mouse handlers
- [ ] **Property panel**: Side panel or dialog for editing selected object properties (color, width, text, etc.)
- [ ] **Object list panel**: Sidebar showing all objects with visibility toggles, reordering, and deletion
- [ ] **Planet line editing**: Right-click to edit or remove planet lines
- [ ] **Undo/redo**: Command-based history for object operations

### Priority 2: Enhanced Chart Features
- [x] **Themes**: Dark, Light, Vibe themes with CSS variables, switchable via Edit > Preferences
- [x] **Multiple chart panels**: MDI workspace with tabs, cascade, tile layouts
- [ ] **Chart templates**: Save/load chart configurations (partially implemented)
- [ ] **Technical indicators**: Moving averages, RSI, MACD, Bollinger Bands (legacy has `chartmovave.cpp`, `chartmacd.cpp`)
- [ ] **Fibonacci retracement tool**: Common financial chart tool
- [ ] **Measurement tool**: Distance/percentage between two points
- [ ] **Chart annotations**: Rich text, arrows, callout boxes
- [ ] **Printing / export to image**: Save chart as PNG/SVG

### Priority 3: Data & Connectivity
- [x] **Real-time streaming**: SSE-based live data via TWS bridge
- [x] **Data caching**: File-based cache system in proxy (cache/ folder)
- [ ] **Multiple data sources**: Support for other APIs beyond IB (Yahoo Finance, Alpha Vantage, etc.)
- [ ] **Watchlist**: List of securities with quick switching

### Priority 4: Advanced Planet Features
- [ ] **Aspect lines**: Draw vertical lines at major aspects (conjunction, opposition, square, trine)
- [ ] **Aspect bands**: Colored bands between planet lines showing aspect zones
- [ ] **Transit calculator**: Table of upcoming planetary transits
- [ ] **Multiple planet overlay modes**: Stack, overlay, separate panels
- [ ] **Ephemeris data file loading**: Support for Swiss Ephemeris `.se1` data files for extended date ranges

### Priority 5: Infrastructure
- [x] **Desktop app**: Electron packaging with embedded Express server (Windows installer)
- [ ] **Testing**: Unit tests for engine coordinate transforms, integration tests for save/load
- [ ] **PWA support**: Service worker for offline access to cached data
- [ ] **Performance**: Web Worker for planet calculations, OffscreenCanvas for rendering

---

## File-by-File Reference

### Core Engine
| File | Purpose | Key Exports |
|------|---------|-------------|
| `engine/ChartEngine.ts` | Rendering coordinator, mouse handling, drawing tool state machine | `ChartEngine`, `ChartMouseState`, `DrawingTool` |
| `engine/Viewport.ts` | Zoom/pan state, coordinate transforms | `Viewport` |
| `engine/TimeAxis.ts` | Time-to-pixel mapping, tick generation | `TimeAxis`, `TimeTick` |
| `engine/PriceAxis.ts` | Price-to-pixel mapping, tick generation | `PriceAxis`, `PriceTick` |
| `engine/HitTester.ts` | Point-to-object distance calculations | `HitTester` |

### Renderers
| File | Purpose |
|------|---------|
| `engine/renderers/CandlestickRenderer.ts` | Draws candlestick, bar, and line chart styles |
| `engine/renderers/GridRenderer.ts` | Background grid, crosshair, axes |
| `engine/renderers/VolumeRenderer.ts` | Volume bars in bottom section |
| `engine/renderers/ObjectRenderer.ts` | All chart objects + selection handles + preview |

### Planet System
| File | Purpose | Key Exports |
|------|---------|-------------|
| `planet/EphemerisService.ts` | Dual-backend ephemeris (WASM + equations) | `initSwissEph()`, `getPlanetPosition()`, `getActiveBackend()` |
| `planet/PlanetCalculator.ts` | Maps planet positions to chart price coordinates | `calculatePlanetSamples()` |
| `planet/PlanetRenderer.ts` | Draws planet lines on canvas | `PlanetRenderer` |

### Services
| File | Purpose | Key Exports |
|------|---------|-------------|
| `services/IBService.ts` | IB Client Portal Gateway REST client | `IBService` (authStatus, searchContracts, getHistory, snapshot) |
| `services/FileService.ts` | Chart save/load serialization | `serializeChart()`, `deserializeChart()`, `downloadFile()`, `openFile()` |

### Types
| File | Key Types |
|------|-----------|
| `types/chart.ts` | `OHLCVBar`, `SecurityData`, `ChartConfig`, `ViewState`, `ChartPeriod`, `ChartStyle`, `PenStyle`, `Point`, `Rect` |
| `types/objects.ts` | `ChartObjectBase`, `LineObject`, `HorizontalLineObject`, `VerticalLineObject`, `RectangleObject`, `CircleObject`, `TextObject`, `ChartObjectType` |
| `types/planet.ts` | `PlanetId`, `PlanetCoordinate`, `EphemConfig`, `PlanetLineConfig`, `PlanetLineObject`, `PLANETS` |
| `types/market.ts` | `IBContract`, `IBHistoryBar`, `IBHistoryResponse`, `IBAuthStatus`, `IBField` |

### React Layer
| File | Purpose |
|------|---------|
| `context/ChartContext.tsx` | Per-chart state: security, config, viewState, mouse, planetLines, engineRef, engineVersion |
| `hooks/useChartEngine.ts` | Engine lifecycle: creates engine on mount, syncs React state to engine via effects |
| `hooks/useMarketData.ts` | IB data loading: checkConnection, loadSecurity |
| `components/chart/ChartCanvas.tsx` | Canvas element wrapper, bridges React context to engine |
| `components/chart/ChartPanel.tsx` | Chart container |
| `components/layout/AppLayout.tsx` | Main layout, event wiring, save/load handlers, keyboard shortcuts, ephemeris init |
| `components/layout/MenuBar.tsx` | File/Edit/Insert/View dropdown menus |
| `components/layout/AppToolbar.tsx` | Astro buttons, drawing tools, line style/width, color palette, font selector |
| `components/layout/AppStatusBar.tsx` | Symbol info, period, ephemeris backend, clock |
| `components/dialogs/SymbolSearch.tsx` | IB contract search with debounce |
| `components/dialogs/PlanetLineDialog.tsx` | Planet line configuration form |

---

## Build & Config Notes

### Electron Desktop Build

The desktop app embeds the Express proxy server inside Electron's main process.

**Development:**
```bash
npm run electron:dev
```
This runs: `npm run build` (Vite SPA) → `npm run electron:compile` (tsc for electron/ + proxy/) → `electron .`

**Production installer:**
```bash
npm run electron:build
```
This runs: `npm run build` → `npm run electron:compile` → `electron-builder` (packages to `release/`)

**How it works:**
1. `electron/main.ts` imports `startServer()` from the compiled `proxy/server.js`
2. Calls `startServer({ staticDir: 'dist/', chartsDir: 'public/', cacheDir: 'proxy/cache/' })`
3. Express serves the SPA from `dist/` and handles all API routes on port 5050
4. BrowserWindow loads `http://127.0.0.1:5050`
5. The `/ib` prefix middleware in server.ts rewrites `/ib/status` → `/status` so the same frontend URLs work

**Key files:**
| File | Purpose |
|------|---------|
| `electron/main.ts` | Creates BrowserWindow, starts embedded Express server |
| `electron/preload.ts` | Minimal — exposes `window.ultrachart.platform` |
| `tsconfig.electron.json` | Compiles `electron/` + `proxy/` TS → `dist-electron/` |
| `electron-builder.yml` | Windows NSIS installer + portable config |

### vite.config.ts
- `host: '127.0.0.1'` -- Required for preview tools; do not change to `localhost`
- `port: 3000` -- Default dev server port
- `optimizeDeps.exclude: ['swisseph-wasm']` -- CRITICAL: prevents Vite from pre-bundling the WASM module (which breaks it)
- `server.proxy./ib` -- Proxies `/ib/*` to Express proxy server at `http://127.0.0.1:5050` (strips `/ib` prefix)
- `server.proxy./chart` -- Proxies `/chart/*` to Express proxy server at `http://127.0.0.1:5050`
- `resolve.alias.@` -- Maps `@/` imports to `src/`

### tsconfig.json
- `strict: true` with `noUncheckedIndexedAccess: true` -- Catches array element possibly-undefined bugs
- `noUnusedLocals` / `noUnusedParameters` -- Keeps code clean
- `target: ES2022` -- Modern JS features

### .claude/launch.json
Dev server configuration for Claude preview tools:
```json
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "ultrachart-dev",
      "runtimeExecutable": "npm",
      "runtimeArgs": ["run", "dev"],
      "port": 3000
    }
  ]
}
```

---

## Legacy Code Reference

The original C++ MFC codebase at `legacy/code/appchart/` contains the following key files that were referenced during the web port:

| Legacy File | Key Classes | Web Port Notes |
|-------------|-------------|----------------|
| `chart.h/cpp` | `cChart`, `cTimeAxis`, `cFloatAxis` | Core chart logic -> `ChartEngine.ts`, `Viewport.ts` |
| `chartplanet.h/cpp` | `cChartPlanet`, `DrawLine2()` | Planet line algorithm -> `PlanetCalculator.ts`, `PlanetRenderer.ts` |
| `ephem.h` | `cDllEphem`, `cEphemData` | Swiss Ephemeris wrapper -> `EphemerisService.ts` |
| `chartobj.h/cpp` | `cChartObj`, handle system | Object model -> `ObjectManager.ts`, `types/objects.ts` |
| `chartsam.h/cpp` | `cSampleSec`, `cSampleArray` | OHLCV data -> `types/chart.ts` |
| `barchart.h/cpp` | `cBarChart` | Bar rendering -> `CandlestickRenderer.ts` |
| `chartdata.h/cpp` | Data management | Data loading -> `IBService.ts` |
| `chartmovave.cpp` | Moving averages | Not yet ported |
| `chartmacd.cpp` | MACD indicator | Not yet ported |
| `chartretrace.cpp` | Fibonacci retracement | Not yet ported |
| `chartangle.cpp` | Angle/Gann lines | Not yet ported |
| `chartfigure.cpp` | Chart figures | Not yet ported |
| `chartleastsquare.cpp` | Regression lines | Not yet ported |
| `codeext/sweph/` | Swiss Ephemeris C library | Replaced by `swisseph-wasm` npm package |
