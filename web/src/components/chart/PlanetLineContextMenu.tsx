import { useEffect, useRef } from 'react';
import { PlanetLineObject, PLANETS } from '../../types/planet';
import styles from './ObjectContextMenu.module.css';

interface PlanetLineContextMenuProps {
  pl: PlanetLineObject;
  screenX: number;
  screenY: number;
  onEdit: (pl: PlanetLineObject) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

export function PlanetLineContextMenu({ pl, screenX, screenY, onEdit, onDelete, onClose }: PlanetLineContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const planetInfo = PLANETS.find((p) => p.id === pl.config.planet);
  const displayName = pl.name || `${planetInfo?.name ?? 'Planet'} Line`;

  return (
    <div
      ref={menuRef}
      className={styles.contextMenu}
      style={{ left: screenX, top: screenY }}
    >
      <div className={styles.header}>{displayName}</div>
      <div className={styles.separator} />
      <button
        className={styles.menuItem}
        onClick={() => { onEdit(pl); onClose(); }}
      >
        Edit…
      </button>
      <button
        className={styles.menuItem}
        onClick={() => { onDelete(pl.id); onClose(); }}
      >
        Delete
      </button>
    </div>
  );
}
