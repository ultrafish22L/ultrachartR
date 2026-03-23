# UltraChart Code Review — v1.3.1

**Score: 8.2 / 10**

Reviewed by an imaginary senior React engineer across two sessions. Starting score was 7.5/10 with 11 issues identified. Six have been resolved, bringing the score to 8.2/10.

---

## Resolved Issues

### Session 1 — Critical Fixes

1. **Context menu event listener leak** — `ChartEngine.dispose()` was not removing the `contextmenu` listener added in the constructor. Fixed: added `removeEventListener` in `dispose()`.

2. **`prompt()` blocking call** — Text annotation creation used `window.prompt()`, which blocks the main thread and looks unprofessional. Fixed: replaced with a React `TextInputDialog` component.

3. **`openFile()` cancel handling** — The File System Access API's `showOpenFilePicker` throws `AbortError` when the user cancels. The Promise rejection was unhandled. Fixed: added catch for `AbortError` in `FileService.ts`.

### Session 2 — Code Quality Fixes

4. **Duplicated `distToSegment`** — Identical 13-line point-to-line-segment distance function existed in both `HitTester.ts` (private static) and `PlanetRenderer.ts` (module-level). Fixed: extracted to shared `src/utils/geometry.ts`, both callers now import from there.

5. **Unsafe `fromJSON` casting** — `ObjectManager.fromJSON()` accepted `object[]` and cast blindly to `ChartObject[]`. Malformed data from corrupted `.uchart` files would crash during render. Fixed: parameter changed to `unknown[]`, added `isValidChartObject()` type guard that checks `id`, `type`, `pen`, `visible`, `zIndex` fields and validates against known object types.

6. **`engineRef.current` in useEffect deps** — Three effects in `AppLayout.tsx` depended on `engineRef.current`, which is incorrect because React refs don't trigger re-renders when mutated. The effects only ran by coincidence. Fixed: added `engineVersion` counter state to `ChartContext` that `registerEngine()` increments. Effects now depend on `engineVersion` instead of the ref value.

### Session 2 — UI Improvement

7. **Ephemeris wheel button** — Moved from an isolated position at the far right of the toolbar into the Astro button group where it logically belongs. Replaced the obscure Unicode character with a clear SVG circle+crosshairs icon. Positioned first in the Astro group.

---

## Remaining Items

### Architectural (documented in `docs/architectural-debt.md`)

- **Dual state (React Context vs. ChartEngine)** — ViewState, bars, and config exist in both React state and the imperative engine. The engine is the source of truth for scroll/zoom; React's copy is stale during interaction. Save/serialize code knows to read from the engine. Risk: new code accidentally reads from the stale React copy. Documented workarounds are in place.

- **God component (`AppLayout.tsx`, ~1045 lines)** — Contains 3 components and 9 distinct responsibilities (session restore, file save, keyboard shortcuts, streaming bridge, etc.). Extractable into 4-5 custom hooks (`useWorkspaceSession`, `useChartFileSave`, `useChartKeyboardShortcuts`, `useChartStreamBridge`) + moving `ChartPaneInner` to its own file. Would cut AppLayout to ~400 lines.

### Code Quality (minor)

- **`as any` casts on File System Access API** — Browser TypeScript definitions are incomplete for `showOpenFilePicker`/`showSaveFilePicker`. The `any` casts are unavoidable without custom type declarations.

- **Stale closure risk in streaming callbacks** — One streaming callback may close over stale state. Low probability of triggering in practice.

### Performance (observations, not bugs)

- **`useMemo` dependency arrays** — Some could be tighter, but no measurable impact.

- **ObjectManager mutable array + manual notify** — Works correctly but isn't idiomatic React. The engine needs mutable state for 60fps rendering, so this is a deliberate trade-off.

---

## What the Expert Liked

- The `engineVersion` counter is the textbook solution for bridging imperative refs with React's reactivity
- Runtime validation on `fromJSON` is solid defensive coding for file deserialization
- Documenting architectural debt in `docs/architectural-debt.md` shows maturity — knowing what to fix and why, even when now isn't the time
- Clean separation between imperative canvas engine and React state management
- Swiss Ephemeris WASM with equation fallback is well-engineered resilience
- The save/load system correctly reads from the engine (not stale React state) everywhere

## Bottom Line

Production-quality for a desktop charting application. The remaining items are design trade-offs, not bugs. The codebase is well-organized, the rendering pipeline is clean, and the dual-state architecture — while adding complexity — is a reasonable performance trade-off for a Canvas 2D app.
