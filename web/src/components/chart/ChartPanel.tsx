import { memo } from 'react';
import { ChartCanvas } from './ChartCanvas';
import styles from './ChartPanel.module.css';

/**
 * ChartPanel is the main chart container.
 * It holds the canvas and can later include overlays.
 */
export const ChartPanel = memo(function ChartPanel() {
  return (
    <div className={styles.panel}>
      <ChartCanvas />
    </div>
  );
});
