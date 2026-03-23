import { APP_NAME, APP_VERSION } from '../../constants';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import styles from './AboutDialog.module.css';

interface AboutDialogProps {
  open: boolean;
  onClose: () => void;
}

export function AboutDialog({ open, onClose }: AboutDialogProps) {
  const focusTrapRef = useFocusTrap(open);
  if (!open) return null;

  return (
    <div className={styles.overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={focusTrapRef} className={styles.dialog} role="dialog" aria-modal="true" aria-label="About">
        <div className={styles.header}>
          <h3>About {APP_NAME}</h3>
          <button className={styles.closeBtn} onClick={onClose}>&times;</button>
        </div>
        <div className={styles.body}>
          <div className={styles.appName}>{APP_NAME}</div>
          <div className={styles.version}>v{APP_VERSION}</div>
          <div className={styles.description}>
            Financial security charting application with astrological planet line overlays.
          </div>
          <div className={styles.details}>
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>Engine</span>
              <span>Canvas 2D</span>
            </div>
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>Ephemeris</span>
              <span>Swiss Ephemeris (WASM)</span>
            </div>
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>Data</span>
              <span>IB TWS Gateway</span>
            </div>
          </div>
          <div className={styles.copyright}>
            &copy; 2026 UltraFish
          </div>
        </div>
        <div className={styles.footer}>
          <button className={styles.closeFooterBtn} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
