import { useState, useRef, useEffect, useMemo, memo } from 'react';
import { useWorkspaceCharts, useWorkspaceDrawing } from '../../context/WorkspaceContext';
import { APP_TITLE } from '../../constants';
import styles from './MenuBar.module.css';

interface MenuItem {
  label: string;
  shortcut?: string;
  action?: () => void;
  separator?: boolean;
  disabled?: boolean;
}

interface Menu {
  label: string;
  items: MenuItem[];
}

interface MenuBarProps {
  onOpenChart?: () => void;
  onSaveChart?: () => void;
  onSaveAsChart?: () => void;
  onOpenSymbol?: () => void;
  onInsertPlanetLine?: () => void;
  onCascade?: () => void;
  onTileH?: () => void;
  onTileV?: () => void;
  onPreferences?: () => void;
  onCloseAll?: () => void;
  onSaveTemplate?: () => void;
  onLoadTemplate?: () => void;
  onDelete?: () => void;
  onCopy?: () => void;
  onPaste?: () => void;
  onLoadSample?: (which: 'zs_daily' | 'zs_5min') => void;
  onAbout?: () => void;
  onToggleAgent?: () => void;
}

export const MenuBar = memo(function MenuBar({
  onOpenChart,
  onSaveChart,
  onSaveAsChart,
  onOpenSymbol,
  onInsertPlanetLine,
  onCascade,
  onTileH,
  onTileV,
  onCloseAll,
  onSaveTemplate,
  onLoadTemplate,
  onDelete,
  onCopy,
  onPaste,
  onPreferences,
  onLoadSample,
  onAbout,
  onToggleAgent,
}: MenuBarProps) {
  const [openMenu, setOpenMenu] = useState<number | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const { activeStreamControls: sc } = useWorkspaceCharts();
  const { setDrawingTool } = useWorkspaceDrawing();

  // Store all callbacks in a ref so menus useMemo has zero callback dependencies.
  // Menu items call through the ref, ensuring they always invoke the latest handler.
  const cbRef = useRef({
    onOpenChart, onSaveChart, onSaveAsChart, onOpenSymbol, onInsertPlanetLine,
    onCascade, onTileH, onTileV, onCloseAll, onSaveTemplate, onLoadTemplate,
    onDelete, onCopy, onPaste, onPreferences, onLoadSample, onAbout, onToggleAgent, setDrawingTool,
  });
  cbRef.current = {
    onOpenChart, onSaveChart, onSaveAsChart, onOpenSymbol, onInsertPlanetLine,
    onCascade, onTileH, onTileV, onCloseAll, onSaveTemplate, onLoadTemplate,
    onDelete, onCopy, onPaste, onPreferences, onLoadSample, onAbout, onToggleAgent, setDrawingTool,
  };

  const menus: Menu[] = useMemo(() => [
    {
      label: 'File',
      items: [
        { label: 'Open Chart', shortcut: 'Ctrl+O', action: () => cbRef.current.onOpenChart?.() },
        { label: 'Import Security', shortcut: 'Ctrl+L', action: () => cbRef.current.onOpenSymbol?.() },
        { separator: true, label: '' },
        { label: 'Save', shortcut: 'Ctrl+S', action: () => cbRef.current.onSaveChart?.() },
        { label: 'Save As...', shortcut: 'Ctrl+Shift+S', action: () => cbRef.current.onSaveAsChart?.() },
        { separator: true, label: '' },
        { label: 'Save Template...', action: () => cbRef.current.onSaveTemplate?.() },
        { label: 'Load Template...', action: () => cbRef.current.onLoadTemplate?.() },
        { separator: true, label: '' },
        { label: 'Close All Charts', shortcut: 'Ctrl+Shift+W', action: () => cbRef.current.onCloseAll?.() },
      ],
    },
    {
      label: 'Edit',
      items: [
        { label: 'Copy', shortcut: 'Ctrl+C', action: () => cbRef.current.onCopy?.() },
        { label: 'Paste', shortcut: 'Ctrl+V', action: () => cbRef.current.onPaste?.() },
        { separator: true, label: '' },
        { label: 'Delete', shortcut: 'Del', action: () => cbRef.current.onDelete?.() },
        { separator: true, label: '' },
        { label: 'Preferences...', shortcut: 'Ctrl+P', action: () => cbRef.current.onPreferences?.() },
      ],
    },
    {
      label: 'Insert',
      items: [
        { label: 'Line', shortcut: '1', action: () => cbRef.current.setDrawingTool('line') },
        { label: 'Horizontal Line', shortcut: '2', action: () => cbRef.current.setDrawingTool('horizontalLine') },
        { label: 'Vertical Line', shortcut: '3', action: () => cbRef.current.setDrawingTool('verticalLine') },
        { label: 'Rectangle', shortcut: '4', action: () => cbRef.current.setDrawingTool('rectangle') },
        { label: 'Circle', shortcut: '5', action: () => cbRef.current.setDrawingTool('circle') },
        { label: 'Text', shortcut: '6', action: () => cbRef.current.setDrawingTool('text') },
        { separator: true, label: '' },
        { label: 'Planet Line...', shortcut: '7', action: () => cbRef.current.onInsertPlanetLine?.() },
      ],
    },
    {
      label: 'Window',
      items: [
        { label: 'Cascade', shortcut: 'Shift+C', action: () => cbRef.current.onCascade?.() },
        { label: 'Tile Horizontal', shortcut: 'Shift+H', action: () => cbRef.current.onTileH?.() },
        { label: 'Tile Vertical', shortcut: 'Shift+V', action: () => cbRef.current.onTileV?.() },
      ],
    },
    {
      label: 'Help',
      items: [
        { label: 'Documentation', shortcut: 'F1', action: () => window.open('/help.html', '_blank') },
        { separator: true, label: '' },
        { label: 'Load Sample: ZS Daily', shortcut: 'F2', action: () => cbRef.current.onLoadSample?.('zs_daily') },
        { label: 'Load Sample: ZS 5-min', shortcut: 'F3', action: () => cbRef.current.onLoadSample?.('zs_5min') },
        { separator: true, label: '' },
        { label: 'About UltraChartWeb', action: () => cbRef.current.onAbout?.() },
      ],
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className={styles.menuBar} ref={menuRef}>
      {menus.map((menu, idx) => (
        <div key={menu.label} className={styles.menuContainer}>
          <button
            className={`${styles.menuButton} ${openMenu === idx ? styles.menuButtonActive : ''}`}
            onMouseDown={() => setOpenMenu(openMenu === idx ? null : idx)}
            onMouseEnter={() => {
              if (openMenu !== null) setOpenMenu(idx);
            }}
          >
            {menu.label}
          </button>
          {openMenu === idx && (
            <div className={styles.dropdown}>
              {menu.items.map((item, itemIdx) =>
                item.separator ? (
                  <div key={`sep-${itemIdx}`} className={styles.separator} />
                ) : (
                  <button
                    key={item.label}
                    className={`${styles.menuItem} ${item.disabled ? styles.menuItemDisabled : ''}`}
                    onClick={() => {
                      if (!item.disabled && item.action) {
                        item.action();
                        setOpenMenu(null);
                      }
                    }}
                  >
                    <span>{item.label}</span>
                    {item.shortcut && (
                      <span className={styles.shortcut}>{item.shortcut}</span>
                    )}
                  </button>
                ),
              )}
            </div>
          )}
        </div>
      ))}

      <div className={styles.spacer} />

      <div className={styles.appTitle}>{APP_TITLE}</div>

      <button
        className={styles.agentBtn}
        onClick={() => cbRef.current.onToggleAgent?.()}
        title="Open Agent Window"
      >
        Agent
      </button>

      {sc?.syncing ? (
        <button className={`${styles.liveBtn} ${styles.liveSyncing}`} disabled aria-busy="true">
          <span className={styles.liveDot} />
          Syncing
        </button>
      ) : sc?.streaming ? (
        <button
          className={`${styles.liveBtn} ${styles.liveActive}`}
          onClick={() => sc.stop()}
          title="Stop Live Data"
        >
          <span className={styles.liveDot} />
          Live
        </button>
      ) : (
        <button
          className={styles.liveBtn}
          onClick={() => sc?.start()}
          disabled={!sc?.canStream}
          title={sc?.canStream ? 'Start Live Data' : 'No contract loaded'}
        >
          Live
        </button>
      )}
    </div>
  );
});
