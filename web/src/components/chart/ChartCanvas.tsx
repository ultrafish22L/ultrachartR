import { useCallback, useEffect, useRef, useState } from 'react';
import { useChartEngine } from '../../hooks/useChartEngine';
import { useChart } from '../../context/ChartContext';
import { useWorkspaceDrawing } from '../../context/WorkspaceContext';
import { ChartObject } from '../../types/objects';
import { PlanetLineObject } from '../../types/planet';
import { Point } from '../../types/chart';
import { ObjectContextMenu } from './ObjectContextMenu';
import { PlanetLineContextMenu } from './PlanetLineContextMenu';
import { PlanetLineDialog } from '../dialogs/PlanetLineDialog';
import styles from './ChartCanvas.module.css';

interface ContextMenuState {
  obj: ChartObject;
  screenX: number;
  screenY: number;
}

interface PLContextMenuState {
  pl: PlanetLineObject;
  screenX: number;
  screenY: number;
}

/**
 * ChartCanvas is the React wrapper around the HTML5 Canvas + ChartEngine.
 * It bridges React state with the imperative canvas rendering.
 */
export function ChartCanvas() {
  const { state, updateMouse, planetLines, updatePlanetLine, updatePlanetLinePen, removePlanetLine, registerEngine } = useChart();
  const { drawingTool, setDrawingTool, drawingObjectStyle } = useWorkspaceDrawing();
  const bars = state.security?.bars ?? [];
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [plContextMenu, setPLContextMenu] = useState<PLContextMenuState | null>(null);
  const [editingPlanetLine, setEditingPlanetLine] = useState<PlanetLineObject | null>(null);
  const [textInputPos, setTextInputPos] = useState<{ x: number; y: number } | null>(null);
  const [textInputInitial, setTextInputInitial] = useState('');
  const textCallbackRef = useRef<((text: string) => void) | null>(null);

  const onMouseUpdate = useCallback(
    (mouse: Parameters<typeof updateMouse>[0]) => {
      updateMouse(mouse);
    },
    [updateMouse],
  );

  const onDrawingComplete = useCallback(() => {
    setDrawingTool(null);
  }, [setDrawingTool]);

  const onObjectContextMenu = useCallback(
    (obj: ChartObject, screenX: number, screenY: number) => {
      setPLContextMenu(null);
      setContextMenu({ obj, screenX, screenY });
    },
    [],
  );

  const onPlanetLineContextMenu = useCallback(
    (pl: PlanetLineObject, screenX: number, screenY: number) => {
      setContextMenu(null);
      setPLContextMenu({ pl, screenX, screenY });
    },
    [],
  );

  const onTextInput = useCallback((pixelPos: Point, callback: (text: string) => void, initialText?: string) => {
    textCallbackRef.current = callback;
    setTextInputInitial(initialText ?? '');
    setTextInputPos({ x: pixelPos.x, y: pixelPos.y });
  }, []);

  const { canvasRef, engineRef } = useChartEngine({
    config: state.config,
    bars,
    viewState: state.viewState,
    drawingTool,
    drawingObjectStyle,
    planetLines,
    onMouseUpdate,
    onDrawingComplete,
    onObjectContextMenu,
    onPlanetLineContextMenu,
    onPlanetLinePenChanged: updatePlanetLinePen,
    onPlanetLineDeleted: removePlanetLine,
    onTextInput,
  });

  // Register engine with context for save/load access
  useEffect(() => {
    registerEngine(engineRef.current);
    return () => registerEngine(null);
  }, [engineRef, registerEngine]);

  const handleDeleteObject = useCallback((id: string) => {
    engineRef.current?.objectManager.delete(id);
    engineRef.current?.requestRender();
  }, [engineRef]);

  const handleDeletePlanetLine = useCallback((id: string) => {
    removePlanetLine(id);
  }, [removePlanetLine]);

  const handleEditPlanetLine = useCallback((pl: PlanetLineObject) => {
    setEditingPlanetLine(pl);
  }, []);

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleClosePLContextMenu = useCallback(() => {
    setPLContextMenu(null);
  }, []);

  const handleCloseEditDialog = useCallback(() => {
    setEditingPlanetLine(null);
  }, []);

  const commitTextInput = useCallback((text: string) => {
    if (text.trim()) {
      textCallbackRef.current?.(text);
    }
    textCallbackRef.current = null;
    setTextInputPos(null);
  }, []);

  const cancelTextInput = useCallback(() => {
    textCallbackRef.current = null;
    setTextInputPos(null);
  }, []);

  const textInputRef = useCallback((el: HTMLInputElement | null) => {
    if (el) requestAnimationFrame(() => { el.focus(); el.select(); });
  }, []);

  return (
    <>
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        tabIndex={0}
        role="img"
        aria-label={`Financial chart${state.security ? ` for ${state.security.info.symbol}` : ''}`}
      />
      {contextMenu && (
        <ObjectContextMenu
          obj={contextMenu.obj}
          screenX={contextMenu.screenX}
          screenY={contextMenu.screenY}
          onDelete={handleDeleteObject}
          onClose={handleCloseContextMenu}
        />
      )}
      {plContextMenu && (
        <PlanetLineContextMenu
          pl={plContextMenu.pl}
          screenX={plContextMenu.screenX}
          screenY={plContextMenu.screenY}
          onEdit={handleEditPlanetLine}
          onDelete={handleDeletePlanetLine}
          onClose={handleClosePLContextMenu}
        />
      )}
      {editingPlanetLine && (
        <PlanetLineDialog
          open={true}
          editLine={editingPlanetLine}
          onClose={handleCloseEditDialog}
          onAdd={() => {}} // unused in edit mode
          onUpdate={updatePlanetLine}
        />
      )}
      {textInputPos && (
        <input
          className={styles.inlineTextInput}
          style={{ left: textInputPos.x, top: textInputPos.y }}
          defaultValue={textInputInitial}
          ref={textInputRef}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commitTextInput(e.currentTarget.value);
            } else if (e.key === 'Escape') {
              cancelTextInput();
            }
            e.stopPropagation();
          }}
          onBlur={(e) => commitTextInput(e.currentTarget.value)}
        />
      )}
    </>
  );
}
