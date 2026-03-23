import { useEffect, useRef } from 'react';
import { ChartObject } from '../../types/objects';
import styles from './ObjectContextMenu.module.css';

interface ObjectContextMenuProps {
  obj: ChartObject;
  screenX: number;
  screenY: number;
  onDelete: (id: string) => void;
  onClose: () => void;
}

const TYPE_LABELS: Record<string, string> = {
  line: 'Trend Line',
  horizontalLine: 'Horizontal Line',
  verticalLine: 'Vertical Line',
  rectangle: 'Rectangle',
  circle: 'Circle',
  text: 'Text',
};

export function ObjectContextMenu({ obj, screenX, screenY, onDelete, onClose }: ObjectContextMenuProps) {
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

  const typeLabel = TYPE_LABELS[obj.type] || obj.type;
  const displayName = obj.name || typeLabel;

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
        onClick={() => { onDelete(obj.id); onClose(); }}
      >
        Delete
      </button>
    </div>
  );
}
