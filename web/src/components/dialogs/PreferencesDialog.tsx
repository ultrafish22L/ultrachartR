import { useState, useEffect } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import {
  getActiveBackend,
  setActiveBackend,
  isSwissEphLoaded,
  EphemerisBackend,
} from '../../planet/EphemerisService';
import { useWorkspaceUI, AppTheme } from '../../context/WorkspaceContext';
import {
  loadPreferences,
  savePreferences,
  type ChartLocation,
  type ChartColors,
  type TimelineStyle,
} from '../../services/PreferencesService';
import { applyColorOverrides } from '../../engine/themeColors';
import styles from './PreferencesDialog.module.css';

/** Known locations for topocentric calculations (legacy + expanded) */
const KNOWN_PLACES: { name: string; latitude: number; longitude: number; elevation: number }[] = [
  { name: 'New York, NY', latitude: 40.783, longitude: -73.967, elevation: 27 },
  { name: 'Chicago, IL', latitude: 41.85, longitude: -87.65, elevation: 54 },
  { name: 'Santa Monica, CA', latitude: 34.02, longitude: -118.45, elevation: 31 },
  { name: 'London, UK', latitude: 51.507, longitude: -0.128, elevation: 11 },
  { name: 'Tokyo, Japan', latitude: 35.682, longitude: 139.692, elevation: 40 },
  { name: 'Hong Kong', latitude: 22.32, longitude: 114.17, elevation: 32 },
  { name: 'Singapore', latitude: 1.352, longitude: 103.82, elevation: 15 },
  { name: 'Sydney, Australia', latitude: -33.868, longitude: 151.209, elevation: 58 },
  { name: 'Mumbai, India', latitude: 18.94, longitude: 72.835, elevation: 14 },
  { name: 'Frankfurt, Germany', latitude: 50.11, longitude: 8.682, elevation: 112 },
  { name: 'Toronto, Canada', latitude: 43.653, longitude: -79.383, elevation: 76 },
  { name: 'São Paulo, Brazil', latitude: -23.55, longitude: -46.633, elevation: 760 },
  { name: 'Dubai, UAE', latitude: 25.276, longitude: 55.296, elevation: 5 },
  { name: 'Shanghai, China', latitude: 31.23, longitude: 121.474, elevation: 4 },
];

type Tab = 'appearance' | 'chart' | 'astro' | 'startup';

interface PreferencesDialogProps {
  open: boolean;
  onClose: () => void;
  onEphemChange?: (backend: EphemerisBackend) => void;
}

export function PreferencesDialog({ open, onClose, onEphemChange }: PreferencesDialogProps) {
  const focusTrapRef = useFocusTrap(open);
  const { theme, setTheme, restoreWorkspace, setRestoreWorkspace } = useWorkspaceUI();
  const [tab, setTab] = useState<Tab>('appearance');
  const [ephemBackend, setEphemBackend] = useState<EphemerisBackend>(getActiveBackend);
  const [location, setLocation] = useState<ChartLocation>({ latitude: 34.02, longitude: -118.45, elevation: 22 });
  const [rightMargin, setRightMargin] = useState(0);
  const [chartColors, setChartColors] = useState<ChartColors>({
    bgEnabled: false, bgColor: '#0d1117',
    sleepEnabled: false, sleepColor: 'rgba(200, 70, 70, 0.18)',
    lunchEnabled: false, lunchColor: 'rgba(100, 120, 180, 0.14)',
  });
  const [timelineStyle, setTimelineStyle] = useState<TimelineStyle>('express');
  const sweLoaded = isSwissEphLoaded();

  // Sync when dialog opens
  useEffect(() => {
    if (open) {
      setEphemBackend(getActiveBackend());
      const prefs = loadPreferences();
      setLocation(prefs.location);
      setRightMargin(prefs.rightMargin);
      setChartColors(prefs.chartColors);
      setTimelineStyle(prefs.timelineStyle ?? 'express');
    }
  }, [open]);

  const handleBackendChange = (backend: EphemerisBackend) => {
    setActiveBackend(backend);
    setEphemBackend(getActiveBackend());
    onEphemChange?.(getActiveBackend());
  };

  const updateLocation = (field: keyof ChartLocation, value: number) => {
    const next = { ...location, [field]: value };
    setLocation(next);
    const prefs = loadPreferences();
    prefs.location = next;
    savePreferences(prefs);
  };

  const updateRightMargin = (value: number) => {
    setRightMargin(value);
    const prefs = loadPreferences();
    prefs.rightMargin = value;
    savePreferences(prefs);
    window.dispatchEvent(new CustomEvent('rightMarginChanged', { detail: value }));
  };

  const updateTimelineStyle = (value: TimelineStyle) => {
    setTimelineStyle(value);
    const prefs = loadPreferences();
    prefs.timelineStyle = value;
    savePreferences(prefs);
  };

  const updateChartColors = (updates: Partial<ChartColors>) => {
    const next = { ...chartColors, ...updates };
    setChartColors(next);
    const prefs = loadPreferences();
    prefs.chartColors = next;
    savePreferences(prefs);
    // Apply immediately to canvas rendering
    applyColorOverrides(next);
  };

  if (!open) return null;

  return (
    <div className={styles.overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={focusTrapRef} className={styles.dialog} role="dialog" aria-modal="true" aria-label="Preferences">
        <div className={styles.header}>
          <h3>Preferences</h3>
          <button className={styles.closeBtn} onClick={onClose}>&times;</button>
        </div>

        <div className={styles.tabs}>
          {(['appearance', 'chart', 'astro', 'startup'] as Tab[]).map((t) => (
            <button
              key={t}
              className={`${styles.tab} ${tab === t ? styles.tabActive : ''}`}
              onClick={() => setTab(t)}
            >
              {t === 'appearance' ? 'Appearance' : t === 'chart' ? 'Chart' : t === 'astro' ? 'Astro' : 'Startup'}
            </button>
          ))}
        </div>

        <div className={styles.body}>
          {tab === 'appearance' && (
            <>
              <div className={styles.section}>
                <div className={styles.sectionTitle}>Theme</div>
                <div className={styles.row}>
                  <label>Theme</label>
                  <select
                    value={theme}
                    onChange={(e) => setTheme(e.target.value as AppTheme)}
                  >
                    <option value="dark">Dark</option>
                    <option value="light">Light</option>
                    <option value="vibe">Vibe</option>
                  </select>
                </div>
              </div>

              <div className={styles.section}>
                <div className={styles.sectionTitle}>Chart Colors</div>
                <div className={styles.hint}>
                  Override theme defaults for chart background and session bands.
                </div>

                <div className={styles.colorRow}>
                  <input
                    type="checkbox"
                    checked={chartColors.bgEnabled}
                    onChange={(e) => updateChartColors({ bgEnabled: e.target.checked })}
                  />
                  <label>Chart Background</label>
                  <input
                    type="color"
                    value={chartColors.bgColor.startsWith('rgba') ? '#0d1117' : chartColors.bgColor}
                    disabled={!chartColors.bgEnabled}
                    onChange={(e) => updateChartColors({ bgColor: e.target.value })}
                  />
                </div>

                <div className={styles.colorRow}>
                  <input
                    type="checkbox"
                    checked={chartColors.sleepEnabled}
                    onChange={(e) => updateChartColors({ sleepEnabled: e.target.checked })}
                  />
                  <label>Sleep Session Band</label>
                  <input
                    type="color"
                    value={rgbaToHex(chartColors.sleepColor)}
                    disabled={!chartColors.sleepEnabled}
                    onChange={(e) => updateChartColors({ sleepColor: hexToRgba(e.target.value, 0.18) })}
                  />
                </div>

                <div className={styles.colorRow}>
                  <input
                    type="checkbox"
                    checked={chartColors.lunchEnabled}
                    onChange={(e) => updateChartColors({ lunchEnabled: e.target.checked })}
                  />
                  <label>Lunch Session Band</label>
                  <input
                    type="color"
                    value={rgbaToHex(chartColors.lunchColor)}
                    disabled={!chartColors.lunchEnabled}
                    onChange={(e) => updateChartColors({ lunchColor: hexToRgba(e.target.value, 0.14) })}
                  />
                </div>
              </div>
            </>
          )}

          {tab === 'chart' && (
            <>
              <div className={styles.section}>
                <div className={styles.sectionTitle}>Location (Topocentric)</div>
                <div className={styles.hint}>
                  Used for topocentric planet line calculations.
                </div>
                <div className={styles.row}>
                  <label>Place</label>
                  <select
                    value={
                      KNOWN_PLACES.find(
                        (p) => Math.abs(p.latitude - location.latitude) < 0.01
                          && Math.abs(p.longitude - location.longitude) < 0.01,
                      )?.name ?? '__custom'
                    }
                    onChange={(e) => {
                      const place = KNOWN_PLACES.find((p) => p.name === e.target.value);
                      if (place) {
                        const next = { latitude: place.latitude, longitude: place.longitude, elevation: place.elevation };
                        setLocation(next);
                        const prefs = loadPreferences();
                        prefs.location = next;
                        savePreferences(prefs);
                      }
                    }}
                  >
                    {KNOWN_PLACES.map((p) => (
                      <option key={p.name} value={p.name}>{p.name}</option>
                    ))}
                    {!KNOWN_PLACES.find(
                      (p) => Math.abs(p.latitude - location.latitude) < 0.01
                        && Math.abs(p.longitude - location.longitude) < 0.01,
                    ) && <option value="__custom">Custom</option>}
                  </select>
                </div>
                <div className={styles.row}>
                  <label>Latitude</label>
                  <input
                    type="number"
                    step="0.01"
                    value={location.latitude}
                    onChange={(e) => updateLocation('latitude', parseFloat(e.target.value) || 0)}
                  />
                </div>
                <div className={styles.row}>
                  <label>Longitude</label>
                  <input
                    type="number"
                    step="0.01"
                    value={location.longitude}
                    onChange={(e) => updateLocation('longitude', parseFloat(e.target.value) || 0)}
                  />
                </div>
                <div className={styles.row}>
                  <label>Elevation (m)</label>
                  <input
                    type="number"
                    step="1"
                    value={location.elevation}
                    onChange={(e) => updateLocation('elevation', parseFloat(e.target.value) || 0)}
                  />
                </div>
              </div>

              <div className={styles.section}>
                <div className={styles.sectionTitle}>Right Margin</div>
                <div className={styles.hint}>
                  Extra empty space (px) between the last bar and the price axis.
                </div>
                <div className={styles.row}>
                  <label>Right margin (px)</label>
                  <input
                    type="number"
                    min="0"
                    max="200"
                    step="5"
                    value={rightMargin}
                    onChange={(e) => updateRightMargin(Math.max(0, parseInt(e.target.value) || 0))}
                  />
                </div>
              </div>

              <div className={styles.section}>
                <div className={styles.sectionTitle}>Timeline</div>
                <div className={styles.hint}>
                  Controls how the time axis is displayed on charts.
                </div>
                <div className={styles.row}>
                  <label>Timeline Style</label>
                  <select
                    value={timelineStyle}
                    onChange={(e) => updateTimelineStyle(e.target.value as TimelineStyle)}
                  >
                    <option value="express">Express (compact)</option>
                    <option value="legacy">Legacy (2-row)</option>
                  </select>
                </div>
              </div>
            </>
          )}

          {tab === 'astro' && (
            <>
              <div className={styles.section}>
                <div className={styles.sectionTitle}>Ephemeris</div>

                <div className={styles.row}>
                  <label>Provider</label>
                  <select
                    value={ephemBackend}
                    onChange={(e) => handleBackendChange(e.target.value as EphemerisBackend)}
                  >
                    <option value="swisseph" disabled={!sweLoaded}>
                      Swiss Ephemeris{!sweLoaded ? ' (unavailable)' : ''}
                    </option>
                    <option value="equations">Equations (fallback)</option>
                  </select>
                </div>

                <div className={styles.row}>
                  <label>WASM Status</label>
                  <span className={`${styles.statusBadge} ${sweLoaded ? styles.statusOk : styles.statusWarn}`}>
                    {sweLoaded ? 'Loaded' : 'Not loaded'}
                  </span>
                </div>

                <div className={styles.hint}>
                  Swiss Ephemeris uses high-precision WASM calculations. Equations mode uses simplified
                  Keplerian orbital elements (~1° accuracy).
                </div>
              </div>
            </>
          )}

          {tab === 'startup' && (
            <>
              <div className={styles.section}>
                <div className={styles.sectionTitle}>Startup</div>
                <div className={styles.row}>
                  <label>Restore workspace on startup</label>
                  <input
                    type="checkbox"
                    checked={restoreWorkspace}
                    onChange={(e) => setRestoreWorkspace(e.target.checked)}
                  />
                </div>
                <div className={styles.hint}>
                  When enabled, your open charts will be automatically restored when you reload the page.
                </div>
              </div>

              <div className={styles.section}>
                <div className={styles.sectionTitle}>TWS Connection</div>

                <div className={styles.row}>
                  <label>Proxy Host</label>
                  <input type="text" value="127.0.0.1" readOnly />
                </div>

                <div className={styles.row}>
                  <label>Proxy Port</label>
                  <input type="number" value="5050" readOnly />
                </div>

                <div className={styles.hint}>
                  TWS bridge server settings. Restart the proxy server to apply changes.
                </div>
              </div>
            </>
          )}
        </div>

        <div className={styles.footer}>
          <button className={styles.closeFooterBtn} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/** Convert rgba(...) string to hex color for color input */
function rgbaToHex(rgba: string): string {
  const m = rgba.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return rgba.startsWith('#') ? rgba : '#808080';
  const r = parseInt(m[1]!);
  const g = parseInt(m[2]!);
  const b = parseInt(m[3]!);
  return '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');
}

/** Convert hex color to rgba with specified alpha */
function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
