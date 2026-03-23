# UltraChart Architectural Debt (v1.3.1)

Two structural issues remain from the code review (see `docs/code-review.md`) that would
require significant refactoring to address. Neither is a bug — the app works correctly
today — but both increase the cost of future changes and create categories of subtle
defects that are hard to diagnose.

---

## 1. Dual State: React Context vs. Imperative Engine

### The Problem

UltraChart maintains two independent copies of the same data:

| Data          | React (ChartContext)         | Engine (ChartEngine)                |
|---------------|------------------------------|-------------------------------------|
| viewState     | `state.viewState`            | `viewport.state` (scrollOffset, pixelsPerBar, autoScale) |
| bars          | `state.security.bars`        | `this.bars`                         |
| config        | `state.config`               | `this.config`                       |
| objects       | *(not in React)*             | `objectManager.objects`             |
| planet lines  | `planetLines` (useState)     | `this.planetLines`                  |
| mouse         | `state.mouse`                | `this.mouse`                        |

React state flows **into** the engine via `useEffect` syncs in `useChartEngine.ts`:

```
React state change
  → useEffect fires
    → engine.setData(bars)  /  engine.config = config  /  engine.planetLines = planetLines
      → engine.resize() / engine.requestRender()
```

But the engine mutates its own copies **directly** during user interaction (pan, zoom, draw)
and these mutations do **not** flow back to React:

```
User scrolls the chart
  → engine.viewport.state.scrollOffset += delta   (mutated in place)
  → engine renders immediately
  → React's state.viewState.scrollOffset is STALE
```

### Where It Breaks

1. **viewState divergence** — The engine owns scroll/zoom. React's `viewState` is only
   the *initial* value. By the time you save the workspace, the React viewState is wrong.
   This is why `WorkspaceSessionService.saveWorkspaceSession()` and `buildSaveJson()` both
   read from `engine.viewport.state` instead of the React state — they know React is stale:

   ```typescript
   // WorkspaceSessionService.ts:62
   const liveViewState = engine ? engine.viewport.state : chart.viewState;

   // AppLayout.tsx:929
   const liveViewState = engine ? engine.viewport.cloneState() : state.viewState;
   ```

   Every new consumer of viewState must know this trick or they'll get stale data.

2. **Config one-way sync** — When React config changes (user toggles volume, crosshair),
   `useChartEngine` pushes the new config to the engine. But the engine also stores a
   local `this.config`. If the engine ever mutated config internally, React wouldn't know.
   Currently it doesn't, but the architecture makes it easy to introduce.

3. **Object state lives outside React** — Drawing objects (`ObjectManager.objects`) exist
   only in the engine. There is no React representation. When saving, the code reaches
   directly into the engine:

   ```typescript
   // WorkspaceSessionService.ts:57
   const objects = engine ? (engine.objectManager.toJSON() as ChartObject[]) : [];
   ```

   The `objectCacheRef` module-level Map in `AppLayout.tsx` is a workaround to keep objects
   alive across HMR-triggered engine recreations — because React doesn't own the data.

4. **Mouse throttling mask** — The engine updates `this.mouse` every frame. React gets a
   throttled copy (100ms) via a `useEffect` that checks `Date.now()`:

   ```typescript
   // AppLayout.tsx:911-920
   if (now - mouseThrottleRef.current < 100) return;
   ```

   Components reading `state.mouse` from ChartContext see a different value than
   `engine.mouse`. For the status bar this is fine; for anything time-sensitive it isn't.

### Why It Exists

Canvas rendering needs to be fast (60fps). React's `useReducer` → re-render → `useEffect`
cycle adds latency. The engine bypasses React for performance-critical paths (scroll, zoom,
crosshair rendering). This is a deliberate and reasonable trade-off.

### What a Fix Looks Like

The fix isn't "move everything to React" — that would kill performance. The fix is to make
the engine the **single** source of truth and eliminate the duplicate React copies:

**Option A: Engine-first, React reads via refs**
- Remove `viewState`, `bars`, `config` from `ChartState` (the useReducer state)
- Components that need these values read from `engineRef.current.viewport.state`, etc.
- Eliminates all sync effects in `useChartEngine.ts`
- Downside: components won't re-render on engine changes unless you add a subscription
  mechanism (e.g., `useSyncExternalStore`)

**Option B: useSyncExternalStore**
- Wrap the engine in a store interface that React can subscribe to
- Engine mutations trigger React re-renders only for subscribed slices
- This is the "right" React 18+ answer but requires the most refactoring

**Option C: Accept the status quo, document the rules**
- Keep the current architecture
- Document: "engine owns viewport, objects. React owns config, planet lines."
- Ensure all save/serialize code reads from the engine, not React
- This is what UltraChart does today and it works. The risk is that new code
  accidentally reads from the stale React copy.

### Recommended Path

**Option C for now** — the app works, the workarounds are in place, and the team knows
the pattern. If UltraChart grows to need tighter React integration (e.g., a properties
panel that shows live viewState values), switch to **Option B**.

---

## 2. God Component: AppLayout.tsx (1042 lines)

### The Problem

`AppLayout.tsx` contains **three** components and handles **nine** distinct responsibilities:

**Components in the file:**
1. `AppLayout` (lines 50–704) — the main app shell
2. `ChartPaneWrapper` (lines 715–733) — wraps a chart in ChartProvider
3. `ChartPaneInner` (lines 737–1042) — per-chart logic inside ChartProvider

**Responsibilities mixed into one file:**
1. Workspace session restore (lines 83–179)
2. Workspace session auto-save (lines 183–215)
3. File open/save/saveAs (lines 328–373, 936–973)
4. TWS import + cache loading (lines 244–324)
5. Template save/load (lines 486–525)
6. Planet line management (lines 377–423)
7. Keyboard shortcut handling (lines 529–588, 982–1008)
8. Streaming state bridge (lines 869–907)
9. Dirty tracking + beforeunload (lines 200–215, 842–866)

### Why It's Costly

- **Cognitive load** — Understanding what `ChartPaneInner` does requires reading 300 lines
  of effects. A developer looking for "how does save work" must search through unrelated
  streaming, planet line, and keyboard shortcut code.

- **Dependency chains** — Many `useCallback`s close over workspace state:
  ```typescript
  const handleCloseChart = useCallback((chartId: string) => {
    const chart = wsState.charts.find((c) => c.id === chartId);
    // ...
  }, [wsState.charts, removeChart]);
  ```
  When `wsState.charts` changes (any chart update), this callback recreates, which cascades
  to anything that depends on it.

- **Module-level escape hatches** — Four module-level variables bypass React's component model:
  ```typescript
  const pendingRestoreRef = { current: new Map<string, RestoreData>() };
  const objectCacheRef = { current: new Map<string, ChartObject[]>() };
  const planetLineCallbackRef = { current: null as ... };
  let workspaceRestored = false;
  ```
  These exist because the component is too large to pass data cleanly between its sub-components.

- **ESLint suppression** — The file has 10+ `eslint-disable-next-line` comments on dependency
  arrays. Some are legitimate (mount-only effects), but the density signals that the effect
  dependencies are tangled enough that the linter can't help.

### Proposed Decomposition

#### Extract: `useWorkspaceSession` hook
Pull session restore + auto-save logic out of `AppLayout`:

```typescript
// hooks/useWorkspaceSession.ts
export function useWorkspaceSession() {
  // Session restore on mount (lines 83-179)
  // Auto-save with debounce (lines 183-195)
  // beforeunload handler (lines 199-215)
  // Returns: { isRestoring }
}
```

**Benefit:** 130 lines out of AppLayout. Session logic becomes testable in isolation.
The module-level `workspaceRestored` flag and `pendingRestoreRef` move with it.

#### Extract: `useChartFileSave` hook
Pull save/saveAs logic out of `ChartPaneInner`:

```typescript
// hooks/useChartFileSave.ts
export function useChartFileSave(chartId: string, engineRef: MutableRefObject<ChartEngine | null>) {
  // buildSaveJson (line 925-931)
  // handleSaveChart (lines 936-954)
  // handleSaveAsChart (lines 957-973)
  // save handler registration (lines 976-979)
  // Returns: { save, saveAs }
}
```

**Benefit:** 60 lines out of ChartPaneInner. Save logic becomes reusable if new save
targets are added (e.g., cloud save).

#### Extract: `useChartKeyboardShortcuts` hook
Pull keyboard shortcut handling out of both `AppLayout` and `ChartPaneInner`:

```typescript
// hooks/useChartKeyboardShortcuts.ts
export function useAppKeyboardShortcuts(handlers: AppKeyHandlers) {
  // App-level shortcuts: Ctrl+L, Ctrl+O, Ctrl+P, F1-F5, number keys (lines 529-588)
}

export function useChartKeyboardShortcuts(handlers: ChartKeyHandlers) {
  // Per-chart shortcuts: Ctrl+S, Ctrl+Shift+S, t/v/g/x/m/b/l (lines 982-1008)
}
```

**Benefit:** 80 lines out. Shortcut definitions become declarative and easy to audit.

#### Extract: `useChartStreamBridge` hook
Pull streaming state management out of `ChartPaneInner`:

```typescript
// hooks/useChartStreamBridge.ts
export function useChartStreamBridge(chartId: string, cachePath: string) {
  // useRealtimeData call (line 869-872)
  // Stream controls registration (lines 875-889)
  // Streaming state sync (lines 892-900)
  // Stream error status (lines 903-907)
  // Returns: { streaming, syncing, streamError }
}
```

**Benefit:** 40 lines out. Streaming becomes independently testable.

#### Move: `ChartPaneWrapper` and `ChartPaneInner` to own file
```
components/chart/ChartPane.tsx  ← ChartPaneWrapper + ChartPaneInner
```

**Benefit:** `AppLayout.tsx` shrinks from 1042 to ~400 lines. The chart-specific logic lives
next to the chart components where developers expect to find it.

### After Decomposition

```
AppLayout.tsx          ~400 lines  (layout shell + menu wiring)
ChartPane.tsx          ~200 lines  (chart wrapper + inner pane)
useWorkspaceSession.ts ~150 lines  (session save/restore)
useChartFileSave.ts    ~80 lines   (save/saveAs)
useChartKeyboardShortcuts.ts ~100 lines (all shortcuts)
useChartStreamBridge.ts ~50 lines  (streaming bridge)
```

Total line count stays similar, but each piece has a single responsibility and can be
understood, tested, and modified independently.

### Recommended Path

Start with the two highest-value extractions:

1. **`useWorkspaceSession`** — removes the most module-level state and the most complex
   restore logic. This is the extraction that eliminates `pendingRestoreRef` and
   `workspaceRestored` from `AppLayout.tsx`.

2. **Move `ChartPaneInner` to its own file** — even without extracting hooks, just moving
   the inner component + its helper state to `components/chart/ChartPane.tsx` cuts AppLayout
   in half and makes the codebase navigable.

The other extractions can follow incrementally as the code evolves.

---

## Summary

| Issue | Risk | Effort to Fix | Recommendation |
|-------|------|---------------|----------------|
| Dual state | Medium — stale reads cause subtle bugs | High | Document the rules, fix later if needed |
| God component | Low — works but slows development | Medium | Extract hooks incrementally |

Neither issue is urgent. The app ships and works correctly. These are investments in
long-term maintainability — tackle them when the codebase is actively growing and the
cost of the current structure starts to compound.
