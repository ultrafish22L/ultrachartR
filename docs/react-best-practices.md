# React + TypeScript Application Best Practices

> **Purpose**: AI-keyed reference for building and reviewing React applications. Synthesized from real-world production patterns, code reviews, and optimization work. Each pattern includes the **problem**, **why it matters**, and the **correct pattern** with code.
>
> **Audience**: AI assistants working on React + TypeScript codebases.
> **Scope**: SPA applications with complex state, canvas/imperative integrations, real-time data, and file I/O.

---

## Table of Contents

1. [Component Architecture](#1-component-architecture)
2. [State Management](#2-state-management)
3. [Hooks](#3-hooks)
4. [Performance](#4-performance)
5. [Accessibility](#5-accessibility)
6. [Modal Dialogs](#6-modal-dialogs)
7. [Canvas & Imperative Integration](#7-canvas--imperative-integration)
8. [Real-Time Data & SSE](#8-real-time-data--sse)
9. [Services & Singletons](#9-services--singletons)
10. [File I/O & Persistence](#10-file-io--persistence)
11. [CSS & Theming](#11-css--theming)
12. [TypeScript Patterns](#12-typescript-patterns)
13. [Error Handling](#13-error-handling)
14. [Testing Mindset](#14-testing-mindset)

---

## 1. Component Architecture

### 1.1 Leaf Components Must Use React.memo

**Problem**: Components re-render whenever their parent re-renders, even if their props haven't changed. In apps with frequent state updates (mouse moves, streaming data, animation frames), this causes cascading unnecessary renders.

**Pattern**:
```tsx
// GOOD — memo prevents re-render when props unchanged
export const ChartHeader = memo(function ChartHeader({ title, onClose }: Props) {
  return <div>{title}<button onClick={onClose}>X</button></div>;
});

// BAD — re-renders every time parent renders
export function ChartHeader({ title, onClose }: Props) {
  return <div>{title}<button onClick={onClose}>X</button></div>;
}
```

**When to apply**: Any component that:
- Receives stable/memoized props from a parent that re-renders frequently
- Is a leaf component (renders DOM, no children that change)
- Appears in lists or repeated layouts

**When NOT to apply**: Components whose props change on every render anyway (the comparison cost is wasted).

### 1.2 God Components Must Be Decomposed

**Problem**: Layout components accumulate responsibilities over time — session restore, file I/O, keyboard shortcuts, streaming bridges, dirty tracking. A 1000+ line component with 10+ useEffect hooks and module-level escape hatches is unmaintainable.

**Pattern**: Extract cohesive behavior groups into custom hooks:
```
AppLayout.tsx (1042 lines) → split into:
  useWorkspaceSession()     — restore + auto-save (130 lines)
  useChartFileSave()        — save/saveAs/dirty tracking (60 lines)
  useChartKeyboardShortcuts() — keyboard handler (80 lines)
  useChartStreamBridge()    — streaming state sync (40 lines)
  AppLayout.tsx             — composition only (~400 lines)
```

**Rule of thumb**: If a component has more than 5 useEffect hooks, it needs decomposition.

### 1.3 Avoid Module-Level State Escapes

**Problem**: Module-level variables (`let pendingData = null;` outside components) bypass React's lifecycle and create stale reference bugs, timing issues, and test isolation problems.

**When acceptable**: Singleton caches (preference cache, WASM instance). Always document why.

**When not acceptable**: Passing data between components or across renders. Use refs, context, or state instead.

---

## 2. State Management

### 2.1 Context + useReducer for App State

**Pattern**: Use React Context with `useReducer` for predictable state updates. Define explicit action types.

```tsx
type Action =
  | { type: 'ADD_ITEM'; payload: Item }
  | { type: 'REMOVE_ITEM'; payload: string }
  | { type: 'SET_ACTIVE'; payload: string | null };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'ADD_ITEM':
      return { ...state, items: [...state.items, action.payload] };
    // ...
  }
}
```

**Critical**: Always use discriminated unions for actions. Never use `type: string` with `payload: any`.

### 2.2 Split Context to Avoid Over-Rendering

**Problem**: A single context that includes both frequently-changing data (mouse position, streaming ticks) and stable data (config, theme) causes every consumer to re-render on every mouse move.

**Pattern**: Separate contexts by update frequency:
```
WorkspaceContext  — app-level state (charts, layout, theme) — changes rarely
ChartContext      — per-chart state (config, viewState, mouse) — changes per interaction
```

**Advanced**: For high-frequency data (60fps mouse, streaming ticks), bypass React entirely — write directly to a ref or imperative object, and only sync to React state on a throttled schedule (e.g., 100ms).

### 2.3 Context Value Stabilization

**Problem**: Creating a new object literal in the context provider's `value` prop on every render defeats `React.memo` on all consumers.

```tsx
// BAD — new object every render
<Ctx.Provider value={{ state, dispatch, doThing }}>

// GOOD — memoized value object
const ctxValue = useMemo(() => ({ state, dispatch, doThing }), [state, doThing]);
<Ctx.Provider value={ctxValue}>
```

### 2.4 Dual State Architecture (React + Imperative)

When React state co-exists with an imperative engine (canvas, WebGL, audio, maps):

**Accept the duality**: The engine owns real-time state (viewport, mouse, objects). React owns configuration and UI state. Data flows one-way: React → Engine via useEffect. Engine mutations (pan, zoom, draw) do NOT flow back to React on every frame.

**Sync rules**:
- React → Engine: via useEffect on config/data changes
- Engine → React: only on significant events (drawing complete, object selected), throttled
- Serialization: always read from engine (it has the truth), not from React state

**Document this explicitly** in architectural docs so future developers don't try to "fix" it by syncing everything.

---

## 3. Hooks

### 3.1 useEffect Dependency Correctness

**Problem**: React refs (`useRef`) return a stable object. Including `someRef` in a dependency array is pointless — it never changes, so the effect never re-runs due to it.

```tsx
// BAD — engineRef is a stable ref, this dep does nothing
useEffect(() => {
  engineRef.current?.resize();
}, [engineRef]);  // misleading

// GOOD — empty deps if only using refs
useEffect(() => {
  engineRef.current?.resize();
}, []);  // comment: engineRef is a stable React ref
```

**Rule**: Only include values that actually change and should trigger re-execution. Add a comment when deps look surprisingly empty.

### 3.2 Consolidate Related useEffects

**Problem**: 12 separate useEffect hooks that all write to the same engine object cause:
- Unnecessary intermediate renders
- Hard-to-follow execution order
- Repeated null checks

**Pattern**: Group by semantic purpose:
```tsx
// Effect 1: Sync data, config, and drawing state to engine
useEffect(() => {
  const engine = engineRef.current;
  if (!engine) return;
  engine.setData(bars);
  engine.config = { ...config };
  engine.setDrawingTool(drawingTool);
  engine.planetLines = planetLines;
  engine.resize();
}, [bars, config, drawingTool, planetLines]);

// Effect 2: Sync callbacks (cheap assignments, no side effects)
useEffect(() => {
  const engine = engineRef.current;
  if (!engine) return;
  engine.onMouseUpdate = onMouseUpdate;
  engine.onDrawingComplete = onDrawingComplete;
}, [onMouseUpdate, onDrawingComplete]);
```

**Guideline**: Aim for 2-4 effects per hook/component. If you have more, group by purpose.

### 3.3 useCallback — Only When Needed

**Rule**: Use `useCallback` when:
1. The function is passed as a prop to a `memo`-wrapped child
2. The function is used in a useEffect dependency array
3. The function is used as a subscription/event handler that gets registered/unregistered

**Don't use** `useCallback` for:
- Event handlers on plain DOM elements (no child re-render concern)
- Functions only used inside the same component's render

### 3.4 Custom Hooks for Reusable Behavior

Extract reusable cross-cutting behavior into hooks:

```tsx
// useFocusTrap — traps Tab focus within a container
export function useFocusTrap(open: boolean) {
  const containerRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement as HTMLElement;
    // ... Tab key trapping logic
    return () => previousFocusRef.current?.focus();  // restore focus on close
  }, [open]);

  return containerRef;
}
```

Good candidates for custom hooks:
- Focus management (focus traps, auto-focus)
- Keyboard shortcuts
- Debounced/throttled values
- Animation frame loops
- Intersection/resize observers
- localStorage sync

---

## 4. Performance

### 4.1 Avoid Allocations in Hot Loops

**Problem**: Creating objects in render loops (60fps canvas, large list iterations) creates GC pressure that causes frame drops.

```tsx
// BAD — new Date object per bar, per frame (thousands of allocations/sec)
function getBand(timeMs: number): string {
  const d = new Date(timeMs);
  return d.getHours() < 6 ? 'sleep' : 'none';
}

// GOOD — reuse a single Date object
private static readonly _tempDate = new Date();
static getBand(timeMs: number): string {
  this._tempDate.setTime(timeMs);
  return this._tempDate.getHours() < 6 ? 'sleep' : 'none';
}
```

**Other hot-loop allocation traps**:
- `JSON.stringify()` for cache keys — use string concatenation instead
- `[...array].sort()` every frame — cache sorted result, only re-sort when reference changes
- `ctx.save()`/`ctx.restore()` — necessary but keep the scope minimal
- Template literals in tight loops — pre-compute outside the loop if possible

### 4.2 Cache Expensive Computations by Reference

**Pattern**: Use reference equality to skip re-computation:

```tsx
// ObjectRenderer — only re-sort when the array reference changes
private static _cachedObjects: ChartObject[] | null = null;
private static _cachedSorted: ChartObject[] = [];

static draw(ctx, objects, viewport, bars) {
  if (objects !== this._cachedObjects) {
    this._cachedObjects = objects;
    this._cachedSorted = [...objects].sort((a, b) => a.zIndex - b.zIndex);
  }
  // Use this._cachedSorted
}
```

### 4.3 Cheap Cache Keys

```tsx
// BAD — JSON.stringify on every frame
const key = JSON.stringify(config);  // ~0.1ms per call, 60x/sec = 6ms/sec wasted

// GOOD — manual concatenation
const key = `${config.planet}_${config.period}_${config.offset}_${Math.round(extraTimeMs)}`;
```

### 4.4 Compact Serialization for Storage

```tsx
// BAD — 25-30% larger files for no user benefit
JSON.stringify(data, null, 2);  // pretty-print

// GOOD — compact output for machine-consumed files
JSON.stringify(data);
```

Pretty-print only for files humans will read/edit (config files, docs). Never for save files, cache files, or API payloads.

### 4.5 Preference/Settings Caching

**Problem**: `localStorage.getItem()` + `JSON.parse()` on every access adds up when called from render loops or frequent UI interactions.

**Pattern**: In-memory cache with write-through:
```tsx
let cachedPreferences: AppPreferences | null = null;

export function loadPreferences(): AppPreferences {
  if (cachedPreferences) return cachedPreferences;
  const raw = localStorage.getItem(KEY);
  cachedPreferences = raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  return cachedPreferences;
}

export function savePreferences(prefs: AppPreferences): void {
  cachedPreferences = prefs;
  localStorage.setItem(KEY, JSON.stringify(prefs));
}
```

### 4.6 Debounced Auto-Save

**Problem**: Serializing and saving the entire app state on every change is wasteful.

**Pattern**: Debounce with a synchronous fallback for `beforeunload`:
```tsx
const DEBOUNCE_MS = 2000;
let saveTimer: number | null = null;

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => saveNow(), DEBOUNCE_MS);
}

// Synchronous save on page unload — debounced save may not have fired
window.addEventListener('beforeunload', () => saveNow());
```

---

## 5. Accessibility

### 5.1 Every Interactive Element Needs a Label

```tsx
// BAD — icon-only button with no accessible name
<button onClick={onDraw}><svg>...</svg></button>

// GOOD — aria-label provides the accessible name
<button onClick={onDraw} aria-label="Draw Line" aria-pressed={active}>
  <svg>...</svg>
</button>
```

**Rules**:
- Icon-only buttons: `aria-label`
- Toggle buttons: `aria-pressed={boolean}`
- Loading states: `aria-busy={true}`
- Status indicators: `title` attribute for dot/icon indicators

### 5.2 Semantic Tab Patterns

```tsx
// GOOD — proper ARIA tab pattern with keyboard navigation
<div role="tablist">
  {tabs.map((tab, i) => (
    <button
      key={tab.id}
      role="tab"
      aria-selected={tab.id === activeId}
      tabIndex={tab.id === activeId ? 0 : -1}
      onKeyDown={handleTabKeyDown}  // ArrowLeft/Right, Home, End
    >
      {tab.label}
    </button>
  ))}
</div>
```

**Keyboard navigation** for tablists:
- ArrowLeft/ArrowRight (or Up/Down): move focus between tabs
- Home: first tab
- End: last tab
- Focus follows selection (roving tabindex)

### 5.3 Visually-Hidden Inputs (Not display:none)

**Problem**: `display: none` removes elements from the accessibility tree. Screen readers can't interact with them, and keyboard focus skips them.

```css
/* BAD — invisible to assistive technology */
.radioInput { display: none; }

/* GOOD — visually hidden but accessible */
.radioInput {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* Show focus indicator on the visual label when input is focused */
.radioInput:focus-visible + .radioLabel {
  outline: 2px solid var(--accent-primary);
  outline-offset: 2px;
}
```

---

## 6. Modal Dialogs

### 6.1 Required Dialog Attributes

Every modal dialog must have:
```tsx
<div
  ref={focusTrapRef}
  role="dialog"           // or "alertdialog" for confirmations
  aria-modal="true"
  aria-label="Dialog Title"
>
```

### 6.2 Focus Trap

**Every modal must trap focus**. Tab/Shift+Tab should cycle within the dialog. On close, focus returns to the trigger element.

Use a reusable hook:
```tsx
const focusTrapRef = useFocusTrap(isOpen);
// Attach to the outermost dialog container div
```

### 6.3 Safe Overlay Dismiss

**Problem**: `onClick={onClose}` on the overlay fires when the user starts a drag inside the dialog content and releases on the overlay. This causes accidental dismissal.

```tsx
// BAD — fires on drag-release from inside dialog
<div className="overlay" onClick={onClose}>

// GOOD — only fires if mousedown originated on the overlay itself
<div className="overlay" onMouseDown={(e) => {
  if (e.target === e.currentTarget) onClose();
}}>
```

**Consequence**: You can also remove `onClick={(e) => e.stopPropagation()}` from the inner dialog div since it's no longer needed.

### 6.4 Escape Key Handling

```tsx
useEffect(() => {
  if (!open) return;
  const handler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  };
  document.addEventListener('keydown', handler);
  return () => document.removeEventListener('keydown', handler);
}, [open, onClose]);
```

### 6.5 Replace window.confirm/window.prompt

**Problem**: `window.confirm()` and `window.prompt()` are blocking, unstyled, inaccessible, and break the app's visual flow.

**Pattern**: Create themed `<ConfirmDialog>` and `<TextInputDialog>` components with proper focus traps, ARIA, and styling. Wire them via state:
```tsx
const [confirmState, setConfirmState] = useState<{
  message: string;
  onConfirm: () => void;
} | null>(null);

// To show confirmation:
setConfirmState({
  message: 'Close chart without saving?',
  onConfirm: () => { closeChart(); },
});
```

---

## 7. Canvas & Imperative Integration

### 7.1 Engine Lifecycle in React

```tsx
function useChartEngine(options) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<ChartEngine | null>(null);

  // Mount-only: create engine, wire resize observer
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new ChartEngine(canvas, options.config);
    engineRef.current = engine;

    const ro = new ResizeObserver(() => engine.resize());
    ro.observe(canvas);

    return () => { ro.disconnect(); engine.dispose(); engineRef.current = null; };
  }, []);  // mount-only

  // Sync effects (separate from mount)
  useEffect(() => {
    engineRef.current?.setData(options.bars);
    engineRef.current?.resize();
  }, [options.bars, options.config]);

  return { canvasRef, engineRef };
}
```

**Key principles**:
- Engine creation in mount-only effect (empty deps)
- ResizeObserver for responsive canvas sizing
- Explicit `dispose()` in cleanup
- Subsequent config/data changes in separate effects

### 7.2 requestAnimationFrame Loops

```tsx
useEffect(() => {
  let raf: number;
  const loop = () => {
    // ... update logic
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  return () => cancelAnimationFrame(raf);
}, []);
```

**Always cancel in cleanup**. Use a ref if the loop needs to read changing state without re-registering.

### 7.3 Canvas Rendering Optimization

- **ctx.save()/ctx.restore()**: Use sparingly — they push/pop the entire context state. Only wrap sections that change global state (transforms, clipping, globalAlpha).
- **Batch similar operations**: Set fillStyle once, draw all objects of that color, then switch.
- **Avoid per-pixel operations**: Use paths and batch drawing over `putImageData`.
- **Clip to visible region**: Skip objects entirely outside the viewport before any drawing calls.

---

## 8. Real-Time Data & SSE

### 8.1 Shared Subscription Manager

**Problem**: Multiple components subscribing to the same data source (e.g., stock feed) should share one connection, not open N parallel connections.

**Pattern**: Singleton subscription manager with reference counting:
```
First subscriber  → opens connection
Nth subscriber    → reuses existing connection, gets immediate onConnected
Last unsubscribe  → closes connection
```

### 8.2 Async Gap Guards

**Problem**: After an `await`, the world may have changed — the subscription may have been cancelled, the component unmounted, or the entry removed.

```tsx
// BAD — no guard after await
async function startFeed(entry) {
  await IBService.startFeed(entry.cachePath);
  // entry might be gone by now!
  const unsub = IBService.subscribeFeed(...);
}

// GOOD — guard after every async gap
async function startFeed(entry) {
  await IBService.startFeed(entry.cachePath);

  // Guard: entry may have been removed during the await
  if (!this.feeds.has(entry.cachePath) || entry.subscribers.size === 0) {
    IBService.stopFeed(entry.cachePath).catch(() => {});
    return;
  }

  const unsub = IBService.subscribeFeed(...);
}
```

### 8.3 EventSource Cleanup

**Problem**: EventSource `.onmessage` / `.onerror` handlers are not removed by `.close()`. They can fire after the source is "closed" if events are queued.

**Pattern**: Always null out handlers before closing:
```tsx
function cleanup(eventSource: EventSource) {
  eventSource.onmessage = null;
  eventSource.onerror = null;
  eventSource.onopen = null;
  eventSource.close();
}
```

### 8.4 Callback Guards in Shared Feeds

When broadcasting events to subscribers, guard against the subscriber map being empty (e.g., all subscribers unsubscribed during event processing):

```tsx
onTick: (bar) => {
  if (entry.subscribers.size === 0) return;  // guard
  for (const cb of entry.subscribers.values()) {
    cb.onTick(bar);
  }
},
```

---

## 9. Services & Singletons

### 9.1 Service Layer Architecture

```
Component → Hook → Service → External API
           (React)  (vanilla TS)  (fetch/SSE/WASM)
```

**Services are plain TypeScript classes/objects** — no React imports, no hooks, no JSX. This makes them testable, reusable, and independent of the React lifecycle.

### 9.2 WASM Initialization

**Problem**: WASM modules may fail to load (network error, browser incompatibility). Without a timeout, the app hangs.

**Pattern**:
```tsx
let wasmReady: Promise<boolean> | null = null;

async function initWasm(): Promise<boolean> {
  if (wasmReady) return wasmReady;
  wasmReady = Promise.race([
    doInit().then(() => true),
    new Promise<boolean>(resolve =>
      setTimeout(() => resolve(false), 10_000)
    ),
  ]);
  return wasmReady;
}
```

### 9.3 Logging Service

Use a lightweight logger that can be silenced in production:
```tsx
export const log = {
  info: (tag: string, ...args: unknown[]) => console.log(`[${tag}]`, ...args),
  warn: (tag: string, ...args: unknown[]) => console.warn(`[${tag}]`, ...args),
  error: (tag: string, ...args: unknown[]) => console.error(`[${tag}]`, ...args),
};
```

Tag every log with its source module. This makes filtering trivial.

---

## 10. File I/O & Persistence

### 10.1 Relative URLs for API Calls

**Problem**: Hardcoded `http://localhost:5050/api` breaks when deployed behind a proxy, in Electron, or on a different port.

**Pattern**: Use relative URLs. Let the dev server's proxy or the production server handle routing:
```tsx
// GOOD — works in dev (Vite proxy), production, and Electron
fetch('/chart/save', { method: 'POST', body: JSON.stringify(data) });

// BAD — hardcoded host/port
fetch('http://localhost:5050/chart/save', ...);
```

### 10.2 Forward-Compatible Preferences

Always merge with defaults when loading:
```tsx
const stored = JSON.parse(raw) as Partial<AppPreferences>;
return { ...DEFAULT_PREFERENCES, ...stored };
```

This ensures new preference keys added in future versions get their defaults without breaking existing user data.

### 10.3 Migration Strategy

When the storage format changes:
```tsx
// Check for old keys and migrate
const oldValue = localStorage.getItem('old-key');
if (oldValue) {
  // Transform and save to new key
  savePreferences(migrated);
  localStorage.removeItem('old-key');
}
```

### 10.4 Save Architecture

- **Ctrl+S**: Save to server/filesystem (POST with JSON body)
- **Ctrl+Shift+S**: Save As with native file picker (`showSaveFilePicker` / fallback)
- **Auto-save**: Debounced (2s) with synchronous `beforeunload` fallback
- **Dirty tracking**: Set dirty flag on mutations, clear on save, show indicator in UI

---

## 11. CSS & Theming

### 11.1 CSS Variables for Theming

```css
:root {
  --bg-primary: #0d1117;
  --text-primary: #e6edf3;
  --accent-primary: #58a6ff;
}
[data-theme="light"] {
  --bg-primary: #ffffff;
  --text-primary: #1f2328;
  --accent-primary: #0969da;
}
```

**For canvas**: Read CSS variables into a mutable JS object using `getComputedStyle()`, then use the object in canvas rendering. Call `refreshThemeColors()` when the theme changes.

### 11.2 CSS Modules for Component Styles

- One `.module.css` file per component
- Use `composes` for shared patterns
- Avoid global styles except for CSS variables and resets

### 11.3 Animation Patterns

**State transition animations** (e.g., button glow on activate):
```css
.liveActive {
  animation: glow-in 0.4s ease-out;
}
@keyframes glow-in {
  0% { box-shadow: 0 0 0 rgba(74, 222, 128, 0); }
  50% { box-shadow: 0 0 16px rgba(74, 222, 128, 0.6); }
  100% { box-shadow: 0 0 8px rgba(74, 222, 128, 0.4); }
}
```

**Continuous animations** (e.g., pulsing indicator):
```css
.pulse { animation: pulse 1.5s ease-in-out infinite; }
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
```

### 11.4 Consistent Sizing

Pick a standard and stick to it:
- Toolbar buttons: fixed dimensions (e.g., 22x22px)
- Close buttons: visually distinct (red background), same size as siblings
- Use CSS custom properties for spacing: `--space-sm`, `--space-md`, `--space-lg`

---

## 12. TypeScript Patterns

### 12.1 Discriminated Unions for Actions and Messages

```tsx
type Action =
  | { type: 'ADD'; payload: Item }
  | { type: 'REMOVE'; payload: string };

// TypeScript narrows payload type inside switch cases
```

### 12.2 Strict null checks — Handle Them

```tsx
// BAD — assumes .current is always set
engineRef.current.setData(bars);

// GOOD — guard
const engine = engineRef.current;
if (!engine) return;
engine.setData(bars);
```

### 12.3 Runtime Validation at System Boundaries

Trust internal code. Validate at boundaries:

```tsx
// Deserializing saved data — validate before casting
static fromJSON(json: unknown): ChartObject | null {
  if (!json || typeof json !== 'object') return null;
  const obj = json as Record<string, unknown>;
  if (typeof obj.type !== 'string' || typeof obj.id !== 'string') return null;
  // ... construct validated object
}
```

### 12.4 Avoid `as any`

```tsx
// BAD
const handle = await (window as any).showSaveFilePicker(opts);

// BETTER — declare the shape
declare global {
  interface Window {
    showSaveFilePicker?: (opts: SaveFilePickerOptions) => Promise<FileSystemFileHandle>;
  }
}
const handle = await window.showSaveFilePicker?.(opts);
```

If a proper type doesn't exist, declare a minimal interface rather than using `as any`.

---

## 13. Error Handling

### 13.1 AbortError Is Not an Error

**Problem**: Cancelling a fetch throws an `AbortError`. Treating it as a real error shows false error messages.

```tsx
try {
  const res = await fetch(url, { signal });
} catch (err) {
  if (err instanceof DOMException && err.name === 'AbortError') {
    return;  // Normal cancellation — not an error
  }
  throw err;  // Real error — propagate
}
```

### 13.2 Graceful Degradation

When a feature fails (WASM won't load, API unreachable):
1. Log the error with context
2. Fall back to an alternative (equation-based calculation, cached data)
3. Show the user a non-blocking indicator (status bar message, not a modal)
4. Continue operating — don't crash the whole app

### 13.3 Never Swallow Errors Silently

```tsx
// BAD — error disappears
try { doThing(); } catch {}

// GOOD — at minimum, log it
try { doThing(); } catch (err) {
  log.warn('Module', 'doThing failed:', err);
}
```

---

## 14. Testing Mindset

### 14.1 Verification Checklist for Code Changes

After any change, verify:
1. **TypeScript**: `tsc --noEmit` passes with zero errors
2. **Dev server**: No Vite/webpack errors in server log
3. **Console**: No runtime errors in browser console
4. **Visual**: App renders correctly (screenshot or manual check)
5. **Interaction**: Affected features still work (click, type, keyboard shortcuts)
6. **Edge cases**: Empty state, error state, loading state

### 14.2 What to Watch For in Reviews

**Performance red flags**:
- `new Date()`, `JSON.stringify()`, `[...array].sort()` inside render loops
- Missing `React.memo` on frequently-rendered leaf components
- useEffect with too many or too few dependencies
- Context value object recreated every render

**Memory leak red flags**:
- EventSource/WebSocket without cleanup
- setInterval without clearInterval in cleanup
- addEventListener without removeEventListener
- Subscription without unsubscription
- Growing caches without eviction or cleanup

**Accessibility red flags**:
- `display: none` on form inputs (use visually-hidden pattern)
- Icon-only buttons without `aria-label`
- Dialogs without `role="dialog"`, `aria-modal`, or focus trap
- Custom controls (tabs, menus, toolbars) without ARIA roles or keyboard navigation
- `onClick` on non-interactive elements (`<div>`, `<span>`) without `role` and `tabIndex`

**UX red flags**:
- `window.confirm()` / `window.prompt()` / `window.alert()`
- No loading indicator for async operations
- Destructive actions without confirmation
- No empty state (blank screen when no data)
- Dialog dismiss on overlay click without drag protection

---

## Quick Reference: Common Patterns

| Problem | Solution |
|---------|----------|
| Leaf component re-renders | `React.memo()` |
| Expensive computation in render | `useMemo()` with correct deps |
| Callback identity changes | `useCallback()` with correct deps |
| Ref in useEffect deps | Remove it — refs are stable |
| 10+ useEffects in one component | Consolidate by purpose or extract hooks |
| new Date() in render loop | Reuse static Date object via `.setTime()` |
| JSON.stringify for cache keys | String concatenation of fields |
| Array sort every frame | Cache sorted result, re-sort on reference change |
| localStorage on every access | In-memory cache with write-through |
| Pretty JSON for saves | `JSON.stringify(data)` — no formatting |
| window.confirm() | Custom `<ConfirmDialog>` component |
| display:none on inputs | Visually-hidden CSS pattern |
| Dialog overlay dismiss | `onMouseDown` with `e.target === e.currentTarget` |
| EventSource cleanup | Null handlers before `.close()` |
| Async gap after await | Guard that entry/state still valid |
| Module-level let | Prefer refs or singleton class |
| Hardcoded localhost URL | Relative URL with dev proxy |
| God component (1000+ lines) | Extract custom hooks by responsibility |

---

*Document version: 1.0 — Synthesized from UltraChart project reviews and optimizations.*
