import { useRef, useEffect, useState, useCallback, memo } from 'react';
import type { ChartEngine } from '../../engine/ChartEngine';
import styles from './ChartFooter.module.css';

interface ChartFooterProps {
  engineRef: React.MutableRefObject<ChartEngine | null>;
}

export const ChartFooter = memo(function ChartFooter({ engineRef }: ChartFooterProps) {
  const [scrollPos, setScrollPos] = useState(0);
  const [maxScroll, setMaxScroll] = useState(0);
  const isDraggingSlider = useRef(false);
  const dragCleanupRef = useRef<(() => void) | null>(null);

  // Sync scrollbar position from engine viewport after renders/interactions
  const syncFromEngine = useCallback(() => {
    const engine = engineRef.current;
    if (engine && !isDraggingSlider.current) {
      const vp = engine.viewport;
      const total = vp.barCount;
      const visible = vp.visibleBarCount;
      const max = Math.max(0, total - visible);
      const pos = max - vp.state.scrollOffset;
      setMaxScroll((prev) => prev === max ? prev : max);
      setScrollPos((prev) => prev === pos ? prev : pos);
    }
  }, [engineRef]);

  // Subscribe to engine render events instead of continuous RAF polling
  useEffect(() => {
    const checkEngine = () => {
      const engine = engineRef.current;
      if (engine) {
        // Hook into the engine's render cycle via onAfterRender
        const prevAfterRender = engine.onAfterRender;
        engine.onAfterRender = () => {
          prevAfterRender?.();
          syncFromEngine();
        };
        // Initial sync
        syncFromEngine();
        return () => {
          // Restore previous callback
          if (engine.onAfterRender) {
            engine.onAfterRender = prevAfterRender ?? null;
          }
        };
      }
      return undefined;
    };

    // Engine may not be ready yet on mount — poll briefly until it is
    let cleanup = checkEngine();
    if (!cleanup) {
      const interval = setInterval(() => {
        cleanup = checkEngine();
        if (cleanup) clearInterval(interval);
      }, 100);
      return () => {
        clearInterval(interval);
        cleanup?.();
      };
    }
    return cleanup;
  }, [engineRef, syncFromEngine]);

  const handleSliderChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const engine = engineRef.current;
    if (!engine) return;
    const val = Number(e.target.value);
    const vp = engine.viewport;
    const total = vp.barCount;
    const visible = vp.visibleBarCount;
    const max = Math.max(0, total - visible);
    vp.state.scrollOffset = max - val;
    setScrollPos(val);
    engine.requestRender();
  }, [engineRef]);

  const handleSliderStart = useCallback(() => {
    // Clean up any prior listeners to prevent duplicates (e.g. touch + mouse)
    dragCleanupRef.current?.();
    isDraggingSlider.current = true;
    // Listen for global mouseup/pointerup to catch releases outside the slider
    const handleGlobalUp = () => {
      isDraggingSlider.current = false;
      document.removeEventListener('mouseup', handleGlobalUp);
      document.removeEventListener('pointerup', handleGlobalUp);
      dragCleanupRef.current = null;
    };
    document.addEventListener('mouseup', handleGlobalUp);
    document.addEventListener('pointerup', handleGlobalUp);
    dragCleanupRef.current = handleGlobalUp;
  }, []);

  const handleZoomIn = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const vp = engine.viewport;
    vp.state.pixelsPerBar = Math.min(50, vp.state.pixelsPerBar * 1.3);
    engine.requestRender();
  }, [engineRef]);

  const handleZoomOut = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const vp = engine.viewport;
    const minPx = vp.barCount > 0 ? vp.chartRect.width / (vp.barCount * 1.5) : 0.5;
    vp.state.pixelsPerBar = Math.max(minPx, vp.state.pixelsPerBar / 1.3);
    engine.requestRender();
  }, [engineRef]);

  const handleZoomReset = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const vp = engine.viewport;
    vp.state.pixelsPerBar = 8;
    vp.state.scrollOffset = 0;
    engine.requestRender();
  }, [engineRef]);

  return (
    <div className={styles.footer}>
      <input
        type="range"
        className={styles.scrollbar}
        min={0}
        max={maxScroll}
        value={scrollPos}
        onChange={handleSliderChange}
        onMouseDown={handleSliderStart}
        onTouchStart={handleSliderStart}
      />
      <button className={styles.zoomBtn} onClick={handleZoomOut} title="Zoom Out">&minus;</button>
      <button className={styles.zoomBtn} onClick={handleZoomIn} title="Zoom In">+</button>
      <button className={styles.zoomBtn} onClick={handleZoomReset} title="Reset Zoom">1:1</button>
    </div>
  );
});
