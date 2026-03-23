import { useState, useCallback, useEffect } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import {
  PlanetId,
  PlanetCoordinate,
  PlanetPerspective,
  PlanetLineConfig,
  PlanetLineObject,
  PLANETS,
  DEFAULT_EPHEM_CONFIG,
} from '../../types/planet';
import styles from './PlanetLineDialog.module.css';

interface PlanetLineDialogProps {
  open: boolean;
  onClose: () => void;
  onAdd: (config: PlanetLineConfig) => void;
  /** When provided, dialog opens in edit mode with pre-populated values */
  editLine?: PlanetLineObject;
  /** Called in edit mode to update an existing planet line */
  onUpdate?: (id: string, config: Partial<PlanetLineConfig>) => void;
}

export function PlanetLineDialog({ open, onClose, onAdd, editLine, onUpdate }: PlanetLineDialogProps) {
  const focusTrapRef = useFocusTrap(open);
  const isEdit = !!editLine;
  const [planet, setPlanet] = useState<PlanetId>(PlanetId.Sun);
  const [perspective, setPerspective] = useState<PlanetPerspective>('heliocentric');
  const [coordinate, setCoordinate] = useState<PlanetCoordinate>('longitude');
  const [period, setPeriod] = useState(360);
  const [offset, setOffset] = useState(0);
  const [invert, setInvert] = useState(false);
  const [showVertLines, setShowVertLines] = useState(false);
  const [showBands, setShowBands] = useState(false);

  // Pre-populate fields when editing
  useEffect(() => {
    if (editLine) {
      const c = editLine.config;
      setPlanet(c.planet);
      setPerspective(c.perspective);
      setCoordinate(c.coordinate);
      setPeriod(c.period);
      setOffset(c.offset);
      setInvert(c.invert);
      setShowVertLines(c.showVertLines);
      setShowBands(c.showBands);
    }
  }, [editLine]);

  const handleSubmit = useCallback(() => {
    if (isEdit && onUpdate && editLine) {
      onUpdate(editLine.id, {
        perspective,
        coordinate,
        period,
        offset,
        invert,
        showVertLines,
        showBands,
      });
    } else {
      const config: PlanetLineConfig = {
        ...DEFAULT_EPHEM_CONFIG,
        planet,
        perspective,
        coordinate,
        period,
        offset,
        invert,
        showVertLines,
        showBands,
      };
      onAdd(config);
    }
    onClose();
  }, [isEdit, editLine, planet, perspective, coordinate, period, offset, invert, showVertLines, showBands, onAdd, onUpdate, onClose]);

  if (!open) return null;

  const planetInfo = isEdit ? PLANETS.find((p) => p.id === editLine!.config.planet) : null;

  return (
    <div className={styles.overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={focusTrapRef} className={styles.dialog} role="dialog" aria-modal="true" aria-label="Planet Line Configuration">
        <div className={styles.header}>
          <h3>{isEdit ? `Edit ${planetInfo?.name ?? 'Planet'} Line` : 'Add Planet Line'}</h3>
          <button className={styles.closeBtn} onClick={onClose}>&times;</button>
        </div>

        <div className={styles.body}>
          {!isEdit && (
            <div className={styles.row}>
              <label>Planet</label>
              <select
                value={planet}
                onChange={(e) => setPlanet(Number(e.target.value) as PlanetId)}
              >
                {PLANETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.symbol} {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className={styles.row}>
            <label>Perspective</label>
            <select
              value={perspective}
              onChange={(e) => setPerspective(e.target.value as PlanetPerspective)}
            >
              <option value="heliocentric">Heliocentric</option>
              <option value="geocentric">Geocentric</option>
              <option value="topocentric">Topocentric</option>
            </select>
          </div>

          <div className={styles.row}>
            <label>Coordinate</label>
            <select
              value={coordinate}
              onChange={(e) => setCoordinate(e.target.value as PlanetCoordinate)}
            >
              <option value="longitude">Longitude</option>
              <option value="declination">Declination</option>
              <option value="rightAscension">Right Ascension</option>
              <option value="latitude">Latitude</option>
            </select>
          </div>

          <div className={styles.divider} />

          <div className={styles.row}>
            <label>Period (degrees)</label>
            <input
              type="number"
              value={period}
              onChange={(e) => setPeriod(Number(e.target.value))}
              min={1}
              max={3600}
              step={1}
            />
          </div>

          <div className={styles.row}>
            <label>Offset (F0)</label>
            <input
              type="number"
              value={offset}
              onChange={(e) => setOffset(Number(e.target.value))}
              step={0.1}
            />
          </div>

          <div className={styles.divider} />

          <div className={styles.checkRow}>
            <label>
              <input
                type="checkbox"
                checked={invert}
                onChange={(e) => setInvert(e.target.checked)}
              />
              Invert
            </label>
            <label>
              <input
                type="checkbox"
                checked={showVertLines}
                onChange={(e) => setShowVertLines(e.target.checked)}
              />
              Vertical Lines
            </label>
            <label>
              <input
                type="checkbox"
                checked={showBands}
                onChange={(e) => setShowBands(e.target.checked)}
              />
              Bands
            </label>
          </div>
        </div>

        <div className={styles.footer}>
          <button className={styles.cancelBtn} onClick={onClose}>Cancel</button>
          <button className={styles.addBtn} onClick={handleSubmit}>
            {isEdit ? 'Save' : 'Add Planet Line'}
          </button>
        </div>
      </div>
    </div>
  );
}
