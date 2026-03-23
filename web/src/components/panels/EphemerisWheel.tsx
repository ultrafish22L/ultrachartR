import { useRef, useEffect, useCallback, useState } from 'react';
import { PLANETS, PlanetId } from '../../types/planet';
import { getPlanetPosition, timestampToJD } from '../../planet/EphemerisService';
import { EphemerisWheelRenderer, WheelPlanet } from './EphemerisWheelRenderer';
import styles from './EphemerisWheel.module.css';

/** Planet dot sizes (pixels) — roughly matching legacy sPlanetRads */
const PLANET_RADII: Partial<Record<PlanetId, number>> = {
  [PlanetId.Sun]: 7,
  [PlanetId.Moon]: 4,
  [PlanetId.Mercury]: 3.5,
  [PlanetId.Venus]: 4.5,
  [PlanetId.Mars]: 5,
  [PlanetId.Jupiter]: 6.5,
  [PlanetId.Saturn]: 5.5,
  [PlanetId.Uranus]: 5,
  [PlanetId.Neptune]: 4.5,
  [PlanetId.Pluto]: 3.5,
  [PlanetId.MeanNode]: 3,
  [PlanetId.Chiron]: 3,
};

type Perspective = 'geocentric' | 'heliocentric' | 'topocentric';

const PERSPECTIVE_LABELS: { value: Perspective; label: string; title: string }[] = [
  { value: 'heliocentric', label: '\u2609', title: 'Heliocentric' },
  { value: 'geocentric', label: '\u2295', title: 'Geocentric' },
  { value: 'topocentric', label: '\u2299', title: 'Topocentric' },
];

const MIN_SIZE = 250;
const DEFAULT_SIZE = 380;

interface EphemerisWheelProps {
  timestamp: number | null;
  onClose: () => void;
}

export function EphemerisWheel({ timestamp, onClose }: EphemerisWheelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const windowRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: window.innerWidth - DEFAULT_SIZE - 80, y: 80 });
  const [canvasSize, setCanvasSize] = useState(DEFAULT_SIZE);
  const [perspective, setPerspective] = useState<Perspective>('geocentric');
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const resizeRef = useRef<{ startX: number; startY: number; origSize: number } | null>(null);

  // Calculate planet positions and draw
  const drawWheel = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const ts = timestamp ?? Date.now();
    const jd = timestampToJD(ts);
    const helio = perspective === 'heliocentric';

    const wheelPlanets: WheelPlanet[] = PLANETS
      .filter(p => !(helio && (p.id === PlanetId.Moon || p.id === PlanetId.MeanNode)))
      .map(p => ({
        id: p.id,
        longitude: getPlanetPosition(jd, p.id, 'longitude', helio),
        symbol: p.symbol,
        color: p.defaultColor,
        radius: PLANET_RADII[p.id] ?? 4,
        name: p.name,
      }));

    const label = perspective.charAt(0).toUpperCase() + perspective.slice(1);
    EphemerisWheelRenderer.draw(ctx, canvasSize, wheelPlanets, ts, label);
  }, [timestamp, perspective, canvasSize]);

  // Redraw when timestamp/perspective/size changes
  useEffect(() => {
    const id = requestAnimationFrame(drawWheel);
    return () => cancelAnimationFrame(id);
  }, [drawWheel]);

  // Header drag logic
  const onHeaderMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: pos.x,
      origY: pos.y,
    };

    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = ev.clientX - dragRef.current.startX;
      const dy = ev.clientY - dragRef.current.startY;
      setPos({
        x: dragRef.current.origX + dx,
        y: dragRef.current.origY + dy,
      });
    };

    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [pos]);

  // Resize handle drag logic
  const onResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origSize: canvasSize,
    };

    const onMove = (ev: MouseEvent) => {
      if (!resizeRef.current) return;
      // Use the larger of dx or dy for uniform sizing
      const dx = ev.clientX - resizeRef.current.startX;
      const dy = ev.clientY - resizeRef.current.startY;
      const delta = Math.max(dx, dy);
      setCanvasSize(Math.max(MIN_SIZE, resizeRef.current.origSize + delta));
    };

    const onUp = () => {
      resizeRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [canvasSize]);

  return (
    <div
      ref={windowRef}
      className={styles.window}
      style={{ left: pos.x, top: pos.y }}
    >
      <div className={styles.header} onMouseDown={onHeaderMouseDown}>
        <span className={styles.title}>Ephemeris</span>
        <div className={styles.perspectiveGroup}>
          {PERSPECTIVE_LABELS.map(p => (
            <label key={p.value} className={styles.radioLabel}>
              <input
                type="radio"
                name="ephemPerspective"
                value={p.value}
                checked={perspective === p.value}
                onChange={() => setPerspective(p.value)}
                className={styles.radioInput}
              />
              <span className={`${styles.radioText} ${perspective === p.value ? styles.radioActive : ''}`} title={p.title}>
                {p.label}
              </span>
            </label>
          ))}
        </div>
        <button className={styles.closeBtn} onClick={onClose} title="Close">
          &times;
        </button>
      </div>
      <div className={styles.canvasWrap}>
        <canvas
          ref={canvasRef}
          className={styles.canvas}
          width={canvasSize}
          height={canvasSize}
          style={{ width: canvasSize, height: canvasSize }}
        />
        <div className={styles.resizeHandle} onMouseDown={onResizeMouseDown} />
      </div>
    </div>
  );
}
