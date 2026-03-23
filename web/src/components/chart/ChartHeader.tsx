import { memo } from 'react';
import { ChartStyle, TimeMode, TimelineStyle } from '../../types/chart';
import styles from './ChartHeader.module.css';

function Icon({ d, title, size = 14 }: { d: string; title: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <title>{title}</title>
      <path d={d} />
    </svg>
  );
}

interface ChartHeaderProps {
  title: string;
  exchange?: string;
  description?: string;
  isActive: boolean;
  chartStyle: ChartStyle;
  onStyleChange: (style: ChartStyle) => void;
  showVolume: boolean;
  onToggleVolume: () => void;
  monochromeBars: boolean;
  onToggleMonochrome: () => void;
  timeMode: TimeMode;
  onToggleTimeMode: () => void;
  showSessionBands: boolean;
  onToggleSessionBands: () => void;
  timelineStyle: TimelineStyle;
  onToggleTimelineStyle: () => void;
  onClose: () => void;
}

export const ChartHeader = memo(function ChartHeader({
  title,
  exchange,
  description,
  isActive,
  chartStyle,
  onStyleChange,
  showVolume,
  onToggleVolume,
  monochromeBars,
  onToggleMonochrome,
  timeMode,
  onToggleTimeMode,
  showSessionBands,
  onToggleSessionBands,
  timelineStyle,
  onToggleTimelineStyle,
  onClose,
}: ChartHeaderProps) {
  return (
    <div className={`${styles.header} ${isActive ? styles.headerActive : ''}`}>
      <div className={styles.titleSection}>
        <span className={styles.title}>{title}</span>
        {exchange && <span className={styles.exchange}>{exchange}</span>}
        {description && <span className={styles.description}>{description}</span>}
      </div>

      <div className={styles.controls}>
        <button
          className={`${styles.iconBtn} ${showSessionBands ? styles.btnActive : ''}`}
          onClick={onToggleSessionBands}
          title={showSessionBands ? 'Hide Session Bands' : 'Show Session Bands'}
        >
          <svg width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <title>Session Bands</title>
            <rect x="1" y="2" width="3" height="12" fill={showSessionBands ? 'currentColor' : 'none'} opacity="0.4" />
            <rect x="6.5" y="2" width="3" height="12" fill={showSessionBands ? 'currentColor' : 'none'} opacity="0.4" />
            <rect x="12" y="2" width="3" height="12" fill={showSessionBands ? 'currentColor' : 'none'} opacity="0.4" />
          </svg>
        </button>

        <div className={styles.sep} />

        <div className={styles.group}>
          <button
            className={`${styles.btn} ${chartStyle === 'candlestick' ? styles.btnActive : ''}`}
            onClick={() => onStyleChange('candlestick')}
            title="Candlestick"
          >
            <Icon d="M8 2v12M5 5h6M5 11h6" title="Candlestick" />
          </button>
          <button
            className={`${styles.btn} ${chartStyle === 'bar' ? styles.btnActive : ''}`}
            onClick={() => onStyleChange('bar')}
            title="OHLC Bar"
          >
            <Icon d="M8 2v12M5 5h3M8 11h3" title="Bar" />
          </button>
          <button
            className={`${styles.btn} ${chartStyle === 'line' ? styles.btnActive : ''}`}
            onClick={() => onStyleChange('line')}
            title="Line Chart"
          >
            <Icon d="M2 10l4-5 4 3 4-6" title="Line" />
          </button>
          <button
            className={`${styles.btn} ${monochromeBars ? styles.btnActive : ''}`}
            onClick={onToggleMonochrome}
            title={monochromeBars ? 'Color Bars' : 'Monochrome Bars'}
          >
            <svg width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <title>Bar Color</title>
              <circle cx="8" cy="8" r="5" />
              <path d="M8 3v10" />
              <path d="M8 3a5 5 0 0 1 0 10" fill="currentColor" />
            </svg>
          </button>
        </div>

        <div className={styles.sep} />

        <button
          className={`${styles.iconBtn} ${timelineStyle === 'express' ? styles.btnActive : ''}`}
          onClick={onToggleTimelineStyle}
          title={timelineStyle === 'legacy' ? 'Switch to Express Timeline' : 'Switch to Legacy Timeline'}
        >
          <svg width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <title>Timeline Style</title>
            <line x1="1" y1="10" x2="15" y2="10" />
            <line x1="1" y1="14" x2="15" y2="14" strokeOpacity={timelineStyle === 'legacy' ? '1' : '0.3'} />
            <line x1="3" y1="10" x2="3" y2="7" />
            <line x1="7" y1="10" x2="7" y2="7" />
            <line x1="11" y1="10" x2="11" y2="7" />
          </svg>
        </button>

        <button
          className={`${styles.iconBtn} ${timeMode === 'compressed' ? styles.btnActive : ''}`}
          onClick={onToggleTimeMode}
          title={timeMode === 'compressed' ? 'Natural Time' : 'Compress Chart'}
        >
          <svg width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <title>Compress</title>
            <path d="M2 8h3M11 8h3" />
            <path d="M4 6l-2 2 2 2" />
            <path d="M12 6l2 2-2 2" />
            <line x1="7" y1="4" x2="7" y2="12" />
            <line x1="9" y1="4" x2="9" y2="12" />
          </svg>
        </button>

        <button
          className={`${styles.iconBtn} ${showVolume ? styles.btnActive : ''}`}
          onClick={onToggleVolume}
          title="Toggle Volume"
        >
          <svg width={14} height={14} viewBox="0 0 16 16" fill="currentColor" stroke="none">
            <title>Volume</title>
            <rect x="2" y="8" width="3" height="6" rx="0.5" />
            <rect x="6.5" y="4" width="3" height="10" rx="0.5" />
            <rect x="11" y="6" width="3" height="8" rx="0.5" />
          </svg>
        </button>

        <div className={styles.sep} />

        <button
          className={styles.closeBtn}
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          title="Close"
        >
          &times;
        </button>
      </div>
    </div>
  );
});
