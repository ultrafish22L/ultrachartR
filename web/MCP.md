# UltraChart MCP Integration Guide

Connect your Claude Pro subscription (via Claude Desktop or Claude Code) to UltraChart's trading agent. Claude becomes your charting copilot with persistent memory — it remembers your strategies, observations, and trades across sessions.

---

## How It Works

UltraChart exposes an **MCP server** that gives Claude direct access to:

- **Chart data** — OHLCV bars from cached market data files
- **Technical indicators** — SMA, EMA, RSI computed on the fly
- **Persistent memory** — read/write observations, strategies, knowledge, trade logs
- **Learning contexts** — named workspaces for different trading approaches

The MCP server shares the same `agent-memory/` directory as UltraChart's built-in agent. Anything Claude learns via MCP is available in the built-in agent window and vice versa.

```
Claude Desktop / Claude Code
        │ (stdio)
        ▼
  mcpServer.ts ──→ agent-memory/   ←── Built-in Agent (browser)
        │              │
        ▼              ▼
   proxy/cache/   contexts/<name>/
   (OHLCV data)   observations/
                  strategies/
                  knowledge/
```

---

## Prerequisites

1. **Node.js 18+** installed
2. **UltraChart repo** cloned at `C:\ultrafish\ultrachart\`
3. **Proxy dependencies installed:**
   ```bash
   cd ultrachart/web/proxy
   npm install
   ```
4. **Claude Desktop** or **Claude Code** installed

---

## Setup for Claude Desktop

### 1. Find your config file

| OS      | Path                                                                  |
|---------|-----------------------------------------------------------------------|
| Windows | `%APPDATA%\Claude\claude_desktop_config.json`                         |
| macOS   | `~/Library/Application Support/Claude/claude_desktop_config.json`     |
| Linux   | `~/.config/Claude/claude_desktop_config.json`                         |

### 2. Add the UltraChart server

Edit `claude_desktop_config.json` (create it if it doesn't exist):

```json
{
  "mcpServers": {
    "ultrachart": {
      "command": "npx",
      "args": ["-y", "tsx", "C:\\ultrafish\\ultrachart\\web\\proxy\\agent\\mcpServer.ts"]
    }
  }
}
```

> **Adjust the path** to match where your repo lives. Use double backslashes on Windows.

### 3. Restart Claude Desktop

Quit and reopen the app. You should see "ultrachart" listed in the MCP tools panel (hammer icon).

---

## Setup for Claude Code

Add to your project-level `.claude/settings.json`:

```json
{
  "mcpServers": {
    "ultrachart": {
      "command": "npx",
      "args": ["-y", "tsx", "C:\\ultrafish\\ultrachart\\web\\proxy\\agent\\mcpServer.ts"]
    }
  }
}
```

Or run directly from the CLI:

```bash
cd ultrachart/web/proxy
npm run mcp
```

---

## Available Tools

### Context Management

| Tool | Description |
|------|-------------|
| `list_contexts` | Show all learning contexts and which one is active |
| `create_context` | Create a new named context (e.g., "Soybean Seasonals") |
| `switch_context` | Switch the active context by ID |

### Memory (Persistent Knowledge)

| Tool | Description |
|------|-------------|
| `search_memory` | Search entries by keyword across active context + global |
| `read_memory` | Read a specific memory entry by ID |
| `write_memory` | Store a new observation, strategy, knowledge, or trade entry |
| `list_memories` | List entries by type in the active context |

Memory types:
- **observation** — something noticed on the chart (pattern, level, behavior)
- **strategy** — a defined trading rule or technique
- **knowledge** — general market knowledge, correlations, seasonals
- **trade** — a specific trade record (entry, exit, P&L, notes)

### Chart Data

| Tool | Description |
|------|-------------|
| `list_caches` | List cached data files (symbol, timeframe, bar count, date range) |
| `load_cache_bars` | Load recent OHLCV bars from a cache file |
| `compute_indicator` | Calculate SMA, EMA, or RSI from cached bars |
| `get_chart_state` | Check if UltraChart app is running (live state via built-in agent) |

---

## Getting Started: First Conversation

Once configured, open Claude Desktop and try:

> "List my available chart data"

Claude will call `list_caches` and show you what's in `proxy/cache/`. Then:

> "Load the last 50 bars from ZSK6_5m.json and compute the 20-period SMA"

Claude calls `load_cache_bars` and `compute_indicator`, then discusses the data.

### Setting Up Your First Context

> "Create a context called 'Soybean Seasonals' for tracking seasonal patterns in ZS futures"

This creates `agent-memory/contexts/soybean-seasonals/` with subdirectories for observations, strategies, and knowledge. Everything Claude learns in this conversation gets filed under this context.

> "I've noticed ZS tends to rally from mid-February through April. Store that as an observation."

Claude calls `write_memory` with type "observation" and saves it. Next session, you can ask:

> "What do you remember about soybean seasonal patterns?"

Claude calls `search_memory` and retrieves the observation from disk.

---

## Workflow Ideas

### 1. Post-Session Trade Journal

After a trading day, tell Claude what happened:

> "I went long ZS at 1052 this morning based on the February seasonal rally pattern. Exited at 1061 before the close. +9 points. Store this as a trade."

Over time, Claude accumulates a structured journal. Later:

> "Show me all my soybean trades. What's my win rate? What patterns produced the best results?"

### 2. Strategy Development

Teach Claude a strategy step by step:

> "Create a context called 'Morning Star Reversal'. Here's the setup: I look for a three-candle morning star pattern on the 5-minute chart, confirmed by RSI below 30 on the first candle. Entry is on the close of the third candle, stop is below the first candle's low."

> "Store that as a strategy. Add tags: reversal, candlestick, intraday."

In the next session:

> "Load the last 200 bars from the 5-min cache and compute RSI(14). Were there any periods where RSI dropped below 30?"

Claude can scan the data and highlight potential setup areas.

### 3. Multi-Timeframe Analysis

> "Load 100 daily bars and compute the 50-period SMA. Also load 200 of the 5-minute bars and compute the 20-period EMA. Is the short-term trend aligned with the daily trend?"

### 4. Pattern Documentation

Build a personal encyclopedia of what you see on charts:

> "I'm looking at ZS right now and the planet lines for Jupiter and Saturn are converging near 1070. The last time that happened in September, price reversed sharply. Store this as knowledge with tags: planet-lines, jupiter, saturn, convergence, reversal."

### 5. Pre-Market Preparation

Start each morning with:

> "What context am I in? What strategies have I defined? What observations are relevant to today's session?"

Claude retrieves your active context, lists strategies, and surfaces recent observations.

---

## Paper Trading Ideas

These workflows use UltraChart + MCP together for simulated trading practice.

### Idea 1: Daily Signal Journal

Each day, before the market opens:
1. Load the previous session's cached bars via MCP
2. Ask Claude to identify any strategy setups that occurred
3. Document what you would have traded (entry, stop, target)
4. At end of day, review what actually happened
5. Store results as trade entries with win/loss tags

Over weeks, you build a statistical record of your strategy's performance without risking capital.

### Idea 2: Planet Line Backtesting

UltraChart's unique feature is astrological planet line overlays. Use MCP to systematically study them:

1. Create a context like "Jupiter Support Zones"
2. Load bars around dates where Jupiter lines crossed key price levels
3. Document whether price respected, bounced, or broke through the line
4. Have Claude compute RSI/SMA at those moments for confluence
5. After 20+ observations, ask Claude to summarize the hit rate

### Idea 3: Seasonal Spread Tracking

For agricultural futures like soybeans:

1. Create a context "ZS Seasonal Spreads"
2. Each week, load the latest cached bars and record the price level
3. Store observations about how price is tracking vs. the expected seasonal pattern
4. Compare current year's action against your documented historical knowledge
5. When price deviates significantly from seasonal norms, flag it as a potential trade

### Idea 4: Strategy Iteration Loop

Use Claude as a strategy refinement partner:

1. Define Version 1 of a strategy (basic rules, entry/exit criteria)
2. Paper trade it for two weeks, logging every trade via `write_memory`
3. Ask Claude to analyze: "Review all my trades for this strategy. What's working? What's failing?"
4. Refine the strategy based on findings and store Version 2
5. Repeat the cycle — each iteration is documented and searchable

### Idea 5: Multi-Context Comparison

Run different strategies in separate contexts:

- Context A: "Trend Following" — only takes trades in the direction of the daily SMA
- Context B: "Mean Reversion" — fades extremes when RSI is oversold/overbought
- Context C: "Astro Timing" — only trades around planet line confluences

Paper trade all three simultaneously. After a month:

> "List all my contexts. For each one, list the trades and summarize performance."

Claude cross-references everything and helps you see which approach suits your style.

---

## Shared Memory Between Built-in Agent and MCP

Both interfaces read and write to the same directory:

```
ultrachart/web/agent-memory/
  index.json                    # Context registry
  settings.json                 # Agent settings (API key, model, etc.)
  contexts/
    soybean-seasonals/
      config.json               # Context metadata + mode toggles
      observations/             # JSON files, one per entry
      strategies/
      knowledge/
    morning-star-reversal/
      config.json
      observations/
      strategies/
      knowledge/
  global/
    knowledges/                 # Cross-context knowledge
    strategies/
```

This means:
- Teach Claude a strategy via the built-in Agent button in UltraChart
- Later, open Claude Desktop and ask about it — the knowledge is there
- Write observations from Claude Code, read them from the app
- All entries are plain JSON files, easy to back up or version control

---

## Troubleshooting

### "ultrachart" not showing in Claude Desktop

- Make sure the path in `claude_desktop_config.json` is correct and uses double backslashes on Windows
- Ensure `npm install` has been run in `web/proxy/`
- Restart Claude Desktop completely (quit from system tray, not just close window)

### Tools return empty results

- Cache files live in `web/proxy/cache/`. Import data through UltraChart (Ctrl+L) or load sample data (Help menu) to populate them
- Memory is empty until you create a context and start writing entries

### "UltraChart is not running" from get_chart_state

- This is expected — `get_chart_state` tries to reach the Express server on port 5050
- All other tools (memory, cache, indicators) work without the app running
- Start UltraChart (`npm run dev` from `web/`) and the proxy (`npm start` from `web/proxy/`) for live integration

### MCP server crashes on startup

Check that dependencies are installed:
```bash
cd ultrachart/web/proxy
npm install
npm run mcp   # should print "UltraChart MCP server started" to stderr
```
