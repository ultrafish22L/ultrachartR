# UltraChart Optimization & UX Review — v1.3.1

Comprehensive review focused on rendering performance, React efficiency, memory management,
and user experience quality. Organized by category and severity.

---

## 1. Rendering Performance

### 1.1 [MEDIUM] Array copy + sort every frame in ObjectRenderer
**File**: `engine/renderers/ObjectRenderer.ts:28`

Objects are sorted by zIndex every frame: `[...objects].sort(...)`. With many objects this
creates GC pressure.

**Fix**: Maintain a pre-sorted array; re-sort only when objects change (add/remove/reorder).

### 1.2 [MEDIUM] `new Date()` objects in TimeAxis render loops
**Files**: `engine/TimeAxis.ts:202-253`

`intradayFarZoom`, `intradayDayZoom`, `intradayMediumZoom` create Date objects per bar
in tight loops. With 4000+ visible bars at far zoom, this is thousands of allocations
per frame.

**Fix**: Use timestamp arithmetic instead of Date parsing. Cache day boundaries once.

### 1.3 [MEDIUM] `new Date()` in SessionRenderer per bar
**File**: `engine/renderers/SessionRenderer.ts:31-33`

`getBand()` creates a Date per bar to determine session coloring. Same issue as TimeAxis.

**Fix**: Cache timezone offset; use timestamp math directly.

### 1.4 [MINOR] `JSON.stringify` as planet cache key every frame
**File**: `planet/PlanetRenderer.ts:63`

`JSON.stringify(pl.config)` used to compare configs. Runs every render frame per planet line.

**Fix**: Use a simple reference comparison or cheap hash (concatenate key fields).

### 1.5 [MINOR] Save/restore per object in ObjectRenderer
**File**: `engine/renderers/ObjectRenderer.ts:33-55`

Each object wraps in `ctx.save()/restore()`. Minor overhead, but could batch objects sharing
the same pen style.

### 1.6 [MINOR] PlanetRenderer computes all sample positions
**File**: `planet/PlanetRenderer.ts:78-94`

Pre-computes pixel positions for all samples, including far off-screen ones. Could binary
search for the visible range first.

---

## 2. React Performance

### 2.1 [HIGH] Context value recreation on every state change
**Files**: `WorkspaceContext.tsx:420-433`, `ChartContext.tsx:224-232`

Both contexts include the full `state` object in their `useMemo` dependency array. Any state
change (mouse update, bar append, config toggle) recreates the context value, causing ALL
consumers to re-render.

**Impact**: During streaming (APPEND_BAR/UPDATE_LAST_BAR at high frequency), every chart
component re-renders even though only the bars changed.

**Fix options**:
- Split each context into a "fast" context (bars, mouse) and "slow" context (config, layout)
- Use `useSyncExternalStore` for high-frequency data
- Use selector-based approach (Zustand-style) to subscribe to specific slices

### 2.2 [MEDIUM] 12 separate useEffect hooks in useChartEngine
**File**: `hooks/useChartEngine.ts:117-155`

Each config property gets its own sync effect (showVolume, showGrid, showCrosshair, etc.).
Each creates a closure and runs independently.

**Fix**: Consolidate into 2-3 effects: one for config sync, one for callback registration,
one for data sync.

### 2.3 [MEDIUM] Missing React.memo on leaf components
**Files**: `ChartHeader.tsx`, `ChartPanel.tsx`, `ChartFooter.tsx`

These receive callback props from parents that may recreate on context changes. Without
`React.memo`, they re-render on every parent render even if their props haven't changed.

**Fix**: Wrap with `React.memo`. Particularly impactful for ChartHeader (many props).

### 2.4 [MINOR] Stable ref used as useEffect dependency
**File**: `components/chart/ChartFooter.tsx:33-78`

`handleSliderChange` depends on `engineRef` which is a stable ref object — it never changes.
Several callbacks in ChartFooter have this pattern.

**Fix**: Use `[]` dependency for callbacks that only access stable refs.

---

## 3. Memory & Resource Management

### 3.1 [HIGH] EventSource listener leak in IBService
**File**: `services/IBService.ts:176-206`

`EventSource` subscriptions don't explicitly remove event listeners before closing. If the
EventSource reconnects or errors, listeners accumulate.

**Fix**: Store listener references; call `removeEventListener` before `close()`.

### 3.2 [MEDIUM] FeedSubscriptionManager closure leak
**File**: `services/FeedSubscriptionManager.ts:65-110`

Nested callback closures capture entire `FeedEntry` objects. Rapid subscribe/unsubscribe
cycles can leave multiple EventSource instances with dangling closures.

**Fix**: Null out entry references on unsubscribe; guard callbacks against stale entries.

### 3.3 [MEDIUM] Planet sample cache grows unbounded
**File**: `planet/PlanetRenderer.ts:17-18`

`sampleCacheKeys` Map accumulates entries for deleted planet lines. In long sessions with
many line create/delete cycles, this leaks memory.

**Fix**: Remove cache entries when planet lines are removed.

### 3.4 [MINOR] No WASM initialization timeout
**File**: `planet/EphemerisService.ts:39-53`

If WASM load hangs (network issue, browser restriction), the app waits indefinitely.
The equation fallback only activates on error, not on timeout.

**Fix**: Add a 5-10 second timeout; fall back to equations if WASM doesn't load in time.

---

## 4. Data & Storage

### 4.1 [HIGH] Full workspace serialized on every auto-save
**File**: `services/WorkspaceSessionService.ts:113`

`saveWorkspaceSession()` serializes the entire workspace (all charts, bars, objects, planet
lines) to JSON on every debounced save (2s). With multiple charts each having 5000+ bars,
this can exceed localStorage's ~5MB quota.

**Fix options**:
- Only serialize bar data for `file`-sourced charts (cache/sample charts can be reloaded)
- Implement incremental saves (only changed charts)
- Compress JSON before storing (LZ-string or similar)

### 4.2 [MEDIUM] Preferences loaded from localStorage on every access
**File**: `services/PreferencesService.ts:70-89`

`loadPreferences()` parses JSON every call. Called from EphemerisService, themeColors,
and UI components — multiple times during a single render cycle.

**Fix**: Cache parsed preferences in a module-level variable. Only reparse after `savePreferences()`.

### 4.3 [MEDIUM] Module-level localStorage read on import
**File**: `planet/EphemerisService.ts:67`

`loadPreferences()` called at module scope, blocking module evaluation before app initializes.

**Fix**: Lazy-load on first `getActiveBackend()` call.

### 4.4 [MEDIUM] `updatePreference()` does load+save round-trip
**File**: `services/PreferencesService.ts:106-108`

Every single preference update triggers a full parse + full stringify.

**Fix**: With cached preferences (#4.2), this becomes update-in-memory + stringify-once.

### 4.5 [MINOR] Pretty-printed JSON on save
**File**: `services/FileService.ts:79`

`JSON.stringify(file, null, 2)` adds ~25-30% file size overhead for whitespace.

**Fix**: Use compact stringify for programmatic saves; pretty-print only for explicit export.

---

## 5. UX — Accessibility (Critical)

### 5.1 [HIGH] Menu bar has no keyboard navigation
**File**: `components/layout/MenuBar.tsx:137-145`

Menus open only on mouse events. No arrow key navigation, no `aria-haspopup`,
no `aria-expanded`, no `role="menu"/"menuitem"` attributes.

**Impact**: Keyboard-only users and screen reader users cannot access any menu functionality.

**Fix**: Implement WAI-ARIA menu pattern with arrow keys, Enter/Escape, and proper roles.

### 5.2 [HIGH] Dialogs have no focus trap
**Files**: `ImportDialog.tsx:170`, `PlanetLineDialog.tsx:82`, `PreferencesDialog.tsx:113`

All three dialogs:
- Don't trap focus (Tab can escape to background)
- Don't set initial focus on open
- Don't return focus to trigger element on close
- Missing `aria-modal="true"` and `role="dialog"`

**Fix**: Add focus trap (either custom hook or small library), auto-focus first input, restore
focus on unmount.

### 5.3 [MEDIUM] Tab bar is not semantic
**File**: `components/layout/TabBar.tsx:24-48`

Tabs are `<div onClick>` instead of `<button role="tab">`. Missing `role="tablist"`,
`aria-selected`, keyboard navigation (Left/Right arrows).

**Fix**: Use proper ARIA tab pattern with button elements and keyboard handlers.

### 5.4 [MEDIUM] Toolbar buttons lack aria-labels
**File**: `components/layout/AppToolbar.tsx:51-112`

Icon buttons use only `title` attribute. Screen readers need `aria-label`. Color swatches
have no accessible name. Unicode planet symbols are unreadable by AT.

**Fix**: Add `aria-label` to all icon buttons. Name color swatches with their color value.

---

## 6. UX — Interaction Quality

### 6.1 [MEDIUM] `window.confirm()` for destructive actions
**File**: `components/layout/AppLayout.tsx:220-233`

Browser-default confirm dialogs are used for close/close-all with unsaved changes. These
are unstyled, inaccessible, and jarring in a themed app.

**Fix**: Replace with a custom `ConfirmDialog` component matching the app's theme. Already
have `TextInputDialog` as a pattern to follow.

### 6.2 [MEDIUM] No loading feedback during import
**File**: `components/dialogs/ImportDialog.tsx:283-310`

Clicking "Import" on a TWS security triggers an async download with no progress indicator,
no cancel button, and no error recovery.

**Fix**: Show a spinner/progress bar, disable the button during load, add cancel capability.

### 6.3 [MEDIUM] "Load" vs "Load + Sync" buttons are confusing
**File**: `components/dialogs/ImportDialog.tsx:328-336`

Two buttons with unclear difference. No tooltip or help text explaining what "Sync" does
(fetches new bars from TWS to update the cached file).

**Fix**: Add tooltips. Consider renaming: "Load from Cache" and "Load & Update from TWS".

### 6.4 [MEDIUM] No visual feedback on LIVE button state changes
**File**: `components/layout/MenuBar.tsx:178-201`

LIVE button transitions between states (disconnected → connecting → streaming → syncing)
with only text/color changes. No animation or transition to draw attention to state changes.

**Fix**: Add a subtle pulse animation on state change. Add `aria-busy` during sync.

### 6.5 [MINOR] Preferences auto-save without undo
**File**: `components/dialogs/PreferencesDialog.tsx:378`

All preference changes apply immediately with no undo. The "Close" button doesn't follow
the expected OK/Cancel/Apply pattern. Users who accidentally change a setting can't revert.

**Fix**: Either add an "undo last change" option, or change to Apply/Cancel pattern.

### 6.6 [MINOR] Dialog overlay clicks are too aggressive
**Files**: All dialog overlays

Clicking the overlay dismisses the dialog even during active work (mid-search, mid-config).
Easy to accidentally close a dialog with complex state.

**Fix**: Require click on explicit close button. Or: require double-click on overlay, or
add a brief delay before overlay clicks are accepted.

### 6.7 [MINOR] No empty state for new charts
When the app loads with no workspace to restore, users see an empty gray area with no
guidance on how to get started (import data, load sample, etc.).

**Fix**: Show a centered prompt: "Press F2 for sample data, or Ctrl+L to import from TWS".

---

## 7. UX — Visual Polish

### 7.1 [MINOR] Color swatch selection indicator
**File**: `AppToolbar.tsx:162-169`

The active color swatch uses a CSS class for selection but no hover state. Hard to tell
which color is active when the selection indicator is a thin border on a small 14px square.

**Fix**: Enlarge active swatch slightly, add checkmark overlay, or use a thicker ring.

### 7.2 [MINOR] Status bar indicators not labeled
**File**: `TabBar.tsx:35-37`

Live dot and download dot indicators are purely visual. No title or aria-label.

**Fix**: Add `title="Streaming"` and `title="Downloading"` attributes.

### 7.3 [MINOR] EphemerisWheel radio buttons
**File**: `panels/EphemerisWheel.tsx:148-162`

Radio inputs are hidden and replaced with styled spans. Works visually but breaks keyboard
focus ring and screen reader label association.

**Fix**: Use proper `<label>` wrapping with visible focus styling.

---

## Summary

| Category | High | Medium | Minor | Total |
|----------|------|--------|-------|-------|
| Rendering Performance | 0 | 3 | 3 | 6 |
| React Performance | 1 | 2 | 1 | 4 |
| Memory & Resources | 1 | 2 | 1 | 4 |
| Data & Storage | 1 | 3 | 1 | 5 |
| Accessibility | 2 | 2 | 0 | 4 |
| Interaction Quality | 0 | 4 | 3 | 7 |
| Visual Polish | 0 | 0 | 3 | 3 |
| **Total** | **5** | **16** | **12** | **33** |

## Recommended Priority Order

### Quick wins (< 1 hour each, high impact):
1. Cache preferences in memory (#4.2, #4.3, #4.4) — eliminates redundant localStorage parsing
2. Cache planet config comparison (#1.4) — replace JSON.stringify with reference check
3. Add React.memo to leaf components (#2.3) — reduces re-render cascade
4. Fix EventSource cleanup (#3.1) — prevents listener leak
5. Add WASM timeout (#3.4) — prevents indefinite hang

### Medium effort (2-4 hours, significant UX improvement):
6. Replace `window.confirm()` with themed ConfirmDialog (#6.1)
7. Add import progress/cancel (#6.2)
8. Add focus traps to dialogs (#5.2)
9. Clean up planet cache on delete (#3.3)
10. Consolidate useChartEngine effects (#2.2)

### Larger efforts (half day+, architectural):
11. Split contexts for performance (#2.1)
12. Incremental workspace saves (#4.1)
13. Menu keyboard navigation (#5.1)
14. Tab bar ARIA pattern (#5.3)
15. Date-free timestamp math in renderers (#1.2, #1.3)
