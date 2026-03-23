import { useCallback, useRef, memo } from 'react';
import { ChartInstance } from '../../context/WorkspaceContext';
import styles from './TabBar.module.css';

interface TabBarProps {
  charts: ChartInstance[];
  activeChartId: string | null;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
}

export const TabBar = memo(function TabBar({ charts, activeChartId, onSelectTab, onCloseTab }: TabBarProps) {
  const tabListRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, id: string) => {
      // Middle-click to close
      if (e.button === 1) {
        e.preventDefault();
        onCloseTab(id);
      }
    },
    [onCloseTab],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (charts.length === 0) return;
      const currentIdx = charts.findIndex((c) => c.id === activeChartId);
      let nextIdx = currentIdx;

      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        nextIdx = (currentIdx + 1) % charts.length;
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        nextIdx = (currentIdx - 1 + charts.length) % charts.length;
      } else if (e.key === 'Home') {
        e.preventDefault();
        nextIdx = 0;
      } else if (e.key === 'End') {
        e.preventDefault();
        nextIdx = charts.length - 1;
      } else {
        return;
      }

      if (nextIdx !== currentIdx) {
        onSelectTab(charts[nextIdx]!.id);
        // Focus the new tab button
        const buttons = tabListRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
        buttons?.[nextIdx]?.focus();
      }
    },
    [charts, activeChartId, onSelectTab],
  );

  if (charts.length === 0) return null;

  return (
    <div className={styles.tabBar} role="tablist" ref={tabListRef} onKeyDown={handleKeyDown}>
      {charts.map((chart) => {
        const isActive = chart.id === activeChartId;
        return (
          <button
            key={chart.id}
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            className={`${styles.tab} ${isActive ? styles.tabActive : ''}`}
            title={chart.title}
            onClick={() => onSelectTab(chart.id)}
            onMouseDown={(e) => handleMouseDown(e, chart.id)}
          >
            <span className={styles.tabTitle}>{chart.dirty ? '* ' : ''}{chart.title}</span>
            {chart.downloading && <span className={styles.downloadDot} title="Downloading" />}
            {chart.streaming && !chart.downloading && <span className={styles.liveDot} title="Streaming" />}
            <span
              className={styles.closeBtn}
              role="button"
              aria-label={`Close ${chart.title}`}
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                onCloseTab(chart.id);
              }}
            >
              &times;
            </span>
          </button>
        );
      })}
    </div>
  );
});
