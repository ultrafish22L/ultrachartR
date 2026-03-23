import { memo, useCallback, useRef } from 'react';
import { useWorkspaceDrawing } from '../../context/WorkspaceContext';
import { ChartObjectType } from '../../types/objects';
import { PLANETS } from '../../types/planet';
import styles from './AppToolbar.module.css';

function Icon({ d, title, size = 16 }: { d: string; title: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <title>{title}</title>
      <path d={d} />
    </svg>
  );
}

const ToolButton = memo(function ToolButton({ tool, title, active, onToggle, children }: {
  tool: ChartObjectType;
  title: string;
  active: boolean;
  onToggle: (tool: ChartObjectType) => void;
  children: React.ReactNode;
}) {
  const handleClick = useCallback(() => onToggle(tool), [onToggle, tool]);
  return (
    <button
      className={`${styles.btn} ${active ? styles.btnActive : ''}`}
      onClick={handleClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
    >
      {children}
    </button>
  );
});

const COLOR_PALETTE = [
  '#60a5fa', '#f87171', '#4ade80', '#fbbf24',
  '#a78bfa', '#fb923c', '#22d3ee', '#f472b6',
  '#94a3b8', '#000000', '#e2e8f0', '#ffffff',
];

const PLANET_COLORS = PLANETS.map((p) => ({ color: p.defaultColor, name: p.name }));

const LINE_WIDTHS = [1, 2, 3, 4];
type LineStyle = 'solid' | 'dashed' | 'dotted';

const SYMBOL_STYLE = { fontSize: 13 } as const;
const TEXT_STYLE = { fontSize: 14, fontWeight: 700 } as const;

const FONT_OPTIONS = [
  'Arial',
  'Helvetica',
  'Verdana',
  'Tahoma',
  'Trebuchet MS',
  'Times New Roman',
  'Georgia',
  'Courier New',
  'Consolas',
  'Comic Sans MS',
];

interface AppToolbarProps {
  onPlanetLine?: () => void;
  onQuickMercury?: () => void;
  onQuickMoon?: () => void;
  onQuickSunGeo?: () => void;
  showEphemeris?: boolean;
  onToggleEphemeris?: () => void;
}

export const AppToolbar = memo(function AppToolbar({ onPlanetLine, onQuickMercury, onQuickMoon, onQuickSunGeo, showEphemeris, onToggleEphemeris }: AppToolbarProps) {
  const { drawingTool, setDrawingTool, drawingObjectStyle, setDrawingObjectStyle } = useWorkspaceDrawing();

  const drawingToolRef = useRef(drawingTool);
  drawingToolRef.current = drawingTool;
  const toggleTool = useCallback((tool: ChartObjectType) => {
    setDrawingTool(drawingToolRef.current === tool ? null : tool);
  }, [setDrawingTool]);

  return (
    <div className={styles.toolbar}>
      {/* Draw Tools */}
      <div className={styles.group}>
        <ToolButton tool="line" title="Trend Line" active={drawingTool === 'line'} onToggle={toggleTool}><Icon d="M2 12L14 3" title="Trend Line" /></ToolButton>
        <ToolButton tool="horizontalLine" title="Horizontal Line" active={drawingTool === 'horizontalLine'} onToggle={toggleTool}><Icon d="M2 8h12" title="Horizontal Line" /></ToolButton>
        <ToolButton tool="verticalLine" title="Vertical Line" active={drawingTool === 'verticalLine'} onToggle={toggleTool}><Icon d="M8 2v12" title="Vertical Line" /></ToolButton>
        <ToolButton tool="rectangle" title="Rectangle" active={drawingTool === 'rectangle'} onToggle={toggleTool}><Icon d="M3 4h10v8H3z" title="Rectangle" /></ToolButton>
        <ToolButton tool="circle" title="Circle" active={drawingTool === 'circle'} onToggle={toggleTool}><Icon d="M8 2a6 6 0 100 12A6 6 0 008 2z" title="Circle" /></ToolButton>
        <ToolButton tool="text" title="Text Label" active={drawingTool === 'text'} onToggle={toggleTool}><span style={TEXT_STYLE}>A</span></ToolButton>
        <select
          className={styles.fontSelect}
          value={drawingObjectStyle.fontFamily}
          onChange={(e) => setDrawingObjectStyle({ fontFamily: e.target.value })}
          title="Font Family"
        >
          {FONT_OPTIONS.map((font) => (
            <option key={font} value={font} style={{ fontFamily: font }}>
              {font}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.divider} />

      {/* Astro */}
      <div className={styles.group}>
        <button
          className={`${styles.btn} ${showEphemeris ? styles.btnActive : ''}`}
          onClick={onToggleEphemeris}
          title="Ephemeris Wheel (E)"
          aria-label="Ephemeris Wheel"
          aria-pressed={showEphemeris}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
            <title>Ephemeris Wheel</title>
            <circle cx="8" cy="8" r="6" />
            <line x1="8" y1="2" x2="8" y2="14" />
            <line x1="2" y1="8" x2="14" y2="8" />
          </svg>
        </button>
        <button className={styles.btn} title="Add Planet Line" aria-label="Add Planet Line" onClick={onPlanetLine}>
          <Icon d="M2 14Q5 6 8 8Q11 10 14 2" title="Add Planet Line" />
        </button>
        <button className={styles.btn} title="Mercury Helio 57.7" aria-label="Mercury Helio 57.7" onClick={onQuickMercury}>
          <span style={SYMBOL_STYLE}>{'\u263F'}</span>
        </button>
        <button className={styles.btn} title="Moon Topo 45" aria-label="Moon Topo 45" onClick={onQuickMoon}>
          <span style={SYMBOL_STYLE}>{'\u263D'}</span>
        </button>
        <button className={styles.btn} title="Sun Geo 60" aria-label="Sun Geo 60" onClick={onQuickSunGeo}>
          <span style={SYMBOL_STYLE}>{'\u2609'}</span>
        </button>
      </div>

      <div className={styles.divider} />

      {/* Line Style */}
      <div className={styles.group}>
        {(['solid', 'dashed', 'dotted'] as LineStyle[]).map((ls) => (
          <button
            key={ls}
            className={`${styles.styleBtn} ${drawingObjectStyle.lineStyle === ls ? styles.styleBtnActive : ''}`}
            onClick={() => setDrawingObjectStyle({ lineStyle: ls })}
            title={`Line Style: ${ls.charAt(0).toUpperCase() + ls.slice(1)}`}
          >
            <svg width="16" height="10" viewBox="0 0 16 10">
              <line
                x1="1" y1="5" x2="15" y2="5"
                stroke="currentColor"
                strokeWidth="2"
                strokeDasharray={ls === 'dashed' ? '4,3' : ls === 'dotted' ? '1,3' : 'none'}
              />
            </svg>
          </button>
        ))}
      </div>

      <div className={styles.divider} />

      {/* Line Width */}
      <div className={styles.group}>
        {LINE_WIDTHS.map((w) => (
          <button
            key={w}
            className={`${styles.widthBtn} ${drawingObjectStyle.lineWidth === w ? styles.widthBtnActive : ''}`}
            onClick={() => setDrawingObjectStyle({ lineWidth: w })}
            title={`Line Width: ${w}px`}
          >
            <svg width="16" height="12" viewBox="0 0 16 12">
              <line x1="1" y1="6" x2="15" y2="6" stroke="currentColor" strokeWidth={w} />
            </svg>
          </button>
        ))}
      </div>

      <div className={styles.divider} />

      {/* Color Palette (2 rows) */}
      <div className={styles.colorPalette}>
        <div className={styles.colorRow}>
          {COLOR_PALETTE.map((color) => (
            <button
              key={color}
              className={`${styles.colorSwatch} ${drawingObjectStyle.color === color ? styles.colorActive : ''}`}
              style={{ background: color }}
              onClick={() => setDrawingObjectStyle({ color })}
              title={`Drawing Color: ${color}`}
              aria-label={`Drawing Color: ${color}`}
            />
          ))}
        </div>
        <div className={styles.colorRow}>
          {PLANET_COLORS.map(({ color, name }) => (
            <button
              key={`pl-${color}`}
              className={`${styles.colorSwatch} ${drawingObjectStyle.color === color ? styles.colorActive : ''}`}
              style={{ background: color }}
              onClick={() => setDrawingObjectStyle({ color })}
              title={`${name}: ${color}`}
              aria-label={`${name}: ${color}`}
            />
          ))}
        </div>
      </div>


    </div>
  );
});
