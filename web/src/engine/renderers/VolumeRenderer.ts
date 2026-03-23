import { OHLCVBar, Rect } from '../../types/chart';
import { Viewport } from '../Viewport';
import { themeColors } from '../themeColors';

/**
 * Renders volume bars at the bottom of the chart.
 * Mirrors legacy cChart volume drawing.
 */
export class VolumeRenderer {
  /** Draw volume bars in the volume area */
  static draw(
    ctx: CanvasRenderingContext2D,
    bars: OHLCVBar[],
    viewport: Viewport,
    volumeRect: Rect,
  ): void {
    if (bars.length === 0) return;

    const { startIdx, endIdx } = viewport.visibleRange;
    const pixPerBar = viewport.state.pixelsPerBar;

    // Find max volume in visible range for scaling
    let maxVol = 0;
    for (let i = Math.max(0, startIdx); i < Math.min(bars.length, endIdx); i++) {
      if (bars[i]!.volume > maxVol) maxVol = bars[i]!.volume;
    }
    if (maxVol === 0) return;

    ctx.save();

    const barWidth = Math.max(1, pixPerBar * 0.7);
    const halfBar = barWidth / 2;
    const lo = Math.max(0, startIdx);
    const hi = Math.min(bars.length, endIdx);
    const bottom = volumeRect.y + volumeRect.height;

    // Batch by color (up/down) to minimize fillStyle changes
    for (let pass = 0; pass < 2; pass++) {
      const isUpPass = pass === 0;
      ctx.fillStyle = isUpPass ? themeColors.volumeUp : themeColors.volumeDown;
      for (let i = lo; i < hi; i++) {
        const bar = bars[i]!;
        if ((bar.close >= bar.open) !== isUpPass) continue;
        const x = Math.round(viewport.barToX(i));
        const barHeight = Math.max(1, (bar.volume / maxVol) * volumeRect.height);
        ctx.fillRect(x - halfBar, bottom - barHeight, barWidth, barHeight);
      }
    }

    ctx.restore();
  }
}
