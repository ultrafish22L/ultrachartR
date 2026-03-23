# UltraChart Code Review — March 2026 (Round 3)

> Fresh strict review after Round 2 fixes (46/60 resolved). Covers engine, rendering, React layer, state management, services, proxy server, and security.
> Prioritized by severity: **HIGH** (significant bugs/perf), **MEDIUM** (correctness/quality), **LOW** (style/minor).

## Summary

| Severity | Count | Fixed |
|----------|-------|-------|
| HIGH | 0 | 0 |
| MEDIUM | 4 | 4 |
| LOW | 5 | 5 |
| **Total** | **9** | **9 ✅** |

All 9 issues resolved. The codebase is in excellent shape after three rounds of review.

---

## 1. Engine & Rendering

### 1.1 MEDIUM — PlanetRenderer.hitTest floating-point accumulation in while loops — ✅ FIXED

**File**: `src/planet/PlanetRenderer.ts`

The while loops used `val0 += period` / `val1 += period` to step through visible price levels. Repeated `+=` accumulates floating-point error.

**Resolution**: Replaced with index-based iteration using `base + n * period` to avoid accumulation. Computes `nMin`/`nMax` from price range, iterates with cap of 1000.

---

## 2. React Components & Hooks

### 2.1 LOW — ChartFooter slider can register duplicate global listeners — ✅ FIXED

**File**: `src/components/chart/ChartFooter.tsx`

`handleSliderStart` added `mouseup`/`pointerup` listeners without cleaning up prior ones.

**Resolution**: Added `dragCleanupRef` to store cleanup function. `handleSliderStart` calls `dragCleanupRef.current?.()` before adding new listeners.

---

## 3. Services & Persistence

### 3.1 MEDIUM — PreferencesService nested objects not type-validated after parse — ✅ FIXED

**File**: `src/services/PreferencesService.ts`

Nested fields like `location`, `chartColors`, `chartDefaults` were spread without type checking. Non-object values like strings would pollute the result with numeric keys.

**Resolution**: Added `safeObj()` helper that validates `typeof val === 'object' && !Array.isArray(val)` before spreading, falling back to empty object.

### 3.2 LOW — IBService EventSource generic error doesn't report to onError callback — ✅ FIXED

**File**: `src/services/IBService.ts`

`onGenericError` only called `fireDisconnected()` when `readyState === CLOSED`. Non-closed errors (404/403) were silently ignored.

**Resolution**: Added `else` branch that calls `callbacks.onError('SSE connection error')` for non-closed states.

### 3.3 LOW — Logger.downloadLog removes element and revokes URL synchronously after click — ✅ FIXED

**File**: `src/services/Logger.ts`

`removeChild` and `revokeObjectURL` executed synchronously after `a.click()`, potentially before the browser processed the download.

**Resolution**: Wrapped cleanup in `setTimeout(() => { ... }, 100)`.

---

## 4. Proxy Server

### 4.1 MEDIUM — `/stream` interval parameter has no bounds validation — ✅ FIXED

**File**: `proxy/server.ts`

`interval` was parsed from query params with no bounds check. Zero or negative values produce degenerate timers.

**Resolution**: Added `if (interval <= 0 || interval > 1440)` guard returning 400 error.

### 4.2 MEDIUM — `/history` query params passed to IB API without validation — ✅ FIXED

**File**: `proxy/server.ts`

`bar` size was passed directly to `reqHistoricalDataAsync()` without validation. Invalid values only fail at the IB layer with a timeout.

**Resolution**: Added `VALID_BAR_SIZES` array (21 known IB bar sizes). Returns 400 for unknown values.

### 4.3 LOW — FeedManager `broadcast` silently swallows write failures — ✅ FIXED

**File**: `proxy/server.ts`

Failed `client.write()` calls were caught but not logged, making SSE disconnection debugging difficult.

**Resolution**: Added `console.log` with `errMsg(err)` in the catch block.

### 4.4 LOW — `/chart/load` sends file content without validating it's parseable JSON — ✅ FIXED

**File**: `proxy/server.ts`

Raw file content was sent with `application/json` content-type without verifying it's valid JSON.

**Resolution**: Added `JSON.parse(content)` validation before sending, returns 500 for invalid JSON.

---

## 5. Summary Table

| # | Issue | Severity | Status |
|---|-------|----------|--------|
| 1.1 | PlanetRenderer hitTest floating-point accumulation | MEDIUM | ✅ FIXED |
| 2.1 | ChartFooter slider duplicate global listeners | LOW | ✅ FIXED |
| 3.1 | PreferencesService nested type validation | MEDIUM | ✅ FIXED |
| 3.2 | IBService EventSource generic error not reported | LOW | ✅ FIXED |
| 3.3 | Logger.downloadLog sync cleanup after click | LOW | ✅ FIXED |
| 4.1 | /stream interval no bounds validation | MEDIUM | ✅ FIXED |
| 4.2 | /history query params not validated | MEDIUM | ✅ FIXED |
| 4.3 | FeedManager broadcast silent write failures | LOW | ✅ FIXED |
| 4.4 | /chart/load no JSON validation | LOW | ✅ FIXED |

### Deferred from Round 2 (architectural, not revisited)

| # | Issue | Severity | Reason |
|---|-------|----------|--------|
| R2-4.1 | WorkspaceContext re-renders all consumers | HIGH | Context splitting / Zustand migration |
| R2-4.2 | ChartContext re-renders on every mouse move | HIGH | Ref-based mouse state needed |
| R2-4.4 | APPEND_CHART_BAR O(n) copy per tick | MEDIUM | Ref-based bar updates needed |
| R2-1.13 | TimeAxis per-tick draw call batching | MEDIUM | 150+ lines of rendering code |
| R2-3.2 | ChartPaneInner not memoized | MEDIUM | Requires prop extraction |
| R2-3.11 | AppToolbar toolBtn inline functions | MEDIUM | Needs ToolButton sub-component |
| R2-3.12 | MenuBar menus useMemo unstable deps | MEDIUM | Requires ref pattern refactoring |

---

## Cumulative Review Stats

| Round | Found | Fixed | Deferred |
|-------|-------|-------|----------|
| Round 1 | 47 | 31 | 16 |
| Round 2 | 60 | 46 | 14 |
| Round 3 | 9 | 9 | 0 |
| **Total** | **116** | **86** | **7 remaining** |

*Review generated March 2026. All 9 Round 3 issues fixed.*
*Build verified: `tsc --noEmit` clean, `vite build` successful (767ms), zero console errors.*
