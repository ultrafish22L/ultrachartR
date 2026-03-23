# UltraChart

A financial charting desktop application with interactive candlestick charts, drawing tools, and planetary cycle overlays computed via Swiss Ephemeris. Built as a modern React/TypeScript rewrite of a legacy C++/MFC app.

## Features

**Charting** — Candlestick, bar (OHLC), and line styles with volume, auto-scaling price axis, crosshair, zoom/pan, and smart grid ticks. All rendering is custom Canvas 2D (no charting library).

**Drawing Tools** — Trend lines, horizontal/vertical lines, rectangles, circles, and text annotations with hit-testing and selection.

**Planet Lines** — 12 celestial bodies across 4 coordinate systems (longitude, latitude, declination, right ascension) in heliocentric or geocentric perspective. Powered by Swiss Ephemeris WASM with a Keplerian equations fallback.

**Market Data** — Live symbol search, historical OHLCV loading, and real-time SSE streaming via Interactive Brokers TWS API. Works fully offline with sample data.

**Workspace** — Multi-chart MDI with tabs, cascade, and tiling layouts. Session persistence across reloads. Save/load charts as `.uchart` JSON files.

**Astro Engine** — Python backend for planetary phase-curve correlation, ML model training, and market timing scoring.

**AI Agent** — Built-in agent window and MCP server for Claude Desktop/Code integration with shared memory and chart data tools.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18, TypeScript 5.6, Vite 6 |
| Rendering | Custom HTML5 Canvas 2D |
| Ephemeris | swisseph-wasm + Keplerian fallback |
| Market Data | Express + @stoqey/ib (TWS API) |
| Desktop | Electron 33, electron-builder |
| Astro Engine | Python 3.11+, pyswisseph, numpy, pandas, scipy |
| AI/Agent | Anthropic SDK, MCP SDK |

## Project Structure

```
ultrachartR/
├── web/                     # React + Electron app
│   ├── src/                 # React components, hooks, services, engine
│   ├── electron/            # Electron main process + preload
│   ├── proxy/               # Express TWS bridge, agent, MCP server
│   └── public/              # Static assets
├── astro-engine/            # Python planetary analysis engine
│   ├── bridge.py            # JSON-over-stdio bridge to TypeScript
│   ├── phase_curves.py      # Planetary cycle computation
│   ├── trainer.py           # ML correlation training
│   ├── scorer.py            # Market timing scoring
│   └── ts-bridge/           # TypeScript client for the engine
├── docs/                    # Architecture docs and code reviews
├── invest/                  # Investment analysis notes
└── legacy/                  # Original C++/MFC codebase (reference)
```

## Ports

| Service | Port | Notes |
|---------|------|-------|
| Vite dev server | 3000 | Web development only |
| Express proxy/TWS bridge | 5050 | Market data, chart I/O, agent |
| IB Trader Workstation | 7496 | External, must be running separately |

## Quick Start

See [QUICKSTART.md](QUICKSTART.md) for installation and setup instructions.

## Documentation

- [QUICKSTART.md](QUICKSTART.md) — Install, run, and use the app
- [web/DEVELOPMENT.md](web/DEVELOPMENT.md) — Architecture deep-dive and state management
- [web/MCP.md](web/MCP.md) — MCP server setup for Claude integration
- [docs/architectural-debt.md](docs/architectural-debt.md) — Known architectural issues
- [docs/optimization-ux-review.md](docs/optimization-ux-review.md) — Performance and UX audit

## License

Private — All rights reserved.
