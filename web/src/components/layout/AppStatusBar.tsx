import { useState, useEffect, useRef, memo } from 'react';
import { useWorkspaceCharts, useWorkspaceUI } from '../../context/WorkspaceContext';
import styles from './AppStatusBar.module.css';

const TIMEZONES = [
  { label: 'Local', value: '' },
  { label: 'UTC', value: 'UTC' },
  { label: 'New York', value: 'America/New_York' },
  { label: 'Chicago', value: 'America/Chicago' },
  { label: 'London', value: 'Europe/London' },
  { label: 'Tokyo', value: 'Asia/Tokyo' },
  { label: 'Sydney', value: 'Australia/Sydney' },
  { label: 'Hong Kong', value: 'Asia/Hong_Kong' },
  { label: 'Singapore', value: 'Asia/Singapore' },
];

function useClock(timezone: string) {
  const [now, setNow] = useState(() => new Date());
  const intervalRef = useRef<number>(0);

  useEffect(() => {
    intervalRef.current = window.setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(intervalRef.current);
  }, []);

  const opts: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    ...(timezone ? { timeZone: timezone } : {}),
  };

  return now.toLocaleString('en-US', opts);
}

export const AppStatusBar = memo(function AppStatusBar() {
  const { activeChart } = useWorkspaceCharts();
  const { statusMessage } = useWorkspaceUI();
  const [timezone, setTimezone] = useState('');

  const security = activeChart?.security ?? null;
  const mouse = activeChart?.mouse ?? null;

  let priceStr = '';
  let ohlcStr = '';

  if (mouse?.inChart && security) {
    const barIdx = Math.round(mouse.barIndex);
    priceStr = mouse.price.toFixed(2);

    if (barIdx >= 0 && barIdx < security.bars.length) {
      const bar = security.bars[barIdx]!;
      ohlcStr = `O:${bar.open.toFixed(2)} H:${bar.high.toFixed(2)} L:${bar.low.toFixed(2)} C:${bar.close.toFixed(2)} V:${bar.volume.toLocaleString()}`;
    }
  }

  const clockStr = useClock(timezone);
  const tzLabel = TIMEZONES.find((tz) => tz.value === timezone)?.label ?? 'Local';

  const msgClass =
    statusMessage.level === 'error' ? styles.msgError :
    statusMessage.level === 'warn' ? styles.msgWarn :
    styles.msgInfo;

  return (
    <div className={styles.statusBar}>
      <div className={styles.left}>
        <span className={`${styles.message} ${msgClass}`}>{statusMessage.text}</span>
      </div>
      <div className={styles.center}>
        {ohlcStr && <span className={styles.ohlc}>{ohlcStr}</span>}
        {!ohlcStr && priceStr && <span className={styles.price}>{priceStr}</span>}
      </div>
      <div className={styles.right}>
        <span className={styles.clock}>{clockStr}</span>
        <select
          className={styles.tzSelect}
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          title={`Timezone: ${tzLabel}`}
        >
          {TIMEZONES.map((tz) => (
            <option key={tz.value} value={tz.value}>{tz.label}</option>
          ))}
        </select>
      </div>
    </div>
  );
});
