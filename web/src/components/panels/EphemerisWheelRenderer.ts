import { PlanetId } from '../../types/planet';

/** Planet data for wheel rendering */
export interface WheelPlanet {
  id: PlanetId;
  longitude: number;   // 0-360 ecliptic degrees
  symbol: string;
  color: string;
  radius: number;       // dot radius in pixels
  name: string;
}

/** Zodiac sign info */
interface ZodiacSign {
  symbol: string;
  name: string;
  color: string;
}

const ZODIAC_SIGNS: ZodiacSign[] = [
  { symbol: '\u2648\uFE0E', name: 'Aries',       color: '#FF3030' },  // Red, bold, fiery
  { symbol: '\u2649\uFE0E', name: 'Taurus',      color: '#5EA040' },  // Moss green, earthy
  { symbol: '\u264A\uFE0E', name: 'Gemini',      color: '#F0D030' },  // Yellow, bright, cheerful
  { symbol: '\u264B\uFE0E', name: 'Cancer',      color: '#90C0E8' },  // Silver, dreamy blue
  { symbol: '\u264C\uFE0E', name: 'Leo',         color: '#F0A820' },  // Gold, orange, sunny
  { symbol: '\u264D\uFE0E', name: 'Virgo',       color: '#6B5B45' },  // Brown, navy, earthy
  { symbol: '\u264E\uFE0E', name: 'Libra',       color: '#F0A0C0' },  // Pink, pastels
  { symbol: '\u264F\uFE0E', name: 'Scorpio',     color: '#A01828' },  // Deep red, dark maroon
  { symbol: '\u2650\uFE0E', name: 'Sagittarius', color: '#9040C0' },  // Purple, plum
  { symbol: '\u2651\uFE0E', name: 'Capricorn',   color: '#686868' },  // Gray, charcoal
  { symbol: '\u2652\uFE0E', name: 'Aquarius',    color: '#20B0E8' },  // Electric blue, turquoise
  { symbol: '\u2653\uFE0E', name: 'Pisces',      color: '#40C0A0' },  // Teal, seafoam green
];

/** Major aspects: [angleDeg, name, color] */
const ASPECTS: [number, string, string][] = [
  // [180, 'opposition', 'rgba(220, 60, 60, 0.45)'],
  [120, 'trine', 'rgba(60, 180, 80, 0.40)'],
  [90,  'square', 'rgba(220, 60, 60, 0.40)'],
  [60,  'sextile', 'rgba(60, 180, 80, 0.35)'],
  [180, 'opposition', 'rgba(220, 60, 60, 0.45)'],
];

const ASPECT_ORB = 8; // degrees tolerance

/**
 * Renders an interactive zodiac wheel on a Canvas 2D context.
 * 0° Aries at the left (9 o'clock), degrees increase counter-clockwise.
 */
export class EphemerisWheelRenderer {

  /** Convert ecliptic longitude to canvas angle (radians).
   *  0° Aries → left (π), increases counter-clockwise. */
  private static lonToAngle(lon: number): number {
    // 0° → π (left), 90° → π/2 (top), 180° → 0 (right), 270° → 3π/2 (bottom)
    return Math.PI - (lon * Math.PI) / 180;
  }

  static draw(
    ctx: CanvasRenderingContext2D,
    size: number,
    planets: WheelPlanet[],
    timestamp: number | null,
    perspective: string,
  ): void {
    const cx = size / 2;
    const cy = size / 2;
    const outerR = size * 0.46;
    const innerR = outerR * 0.78;
    const planetR = innerR * 0.82;

    ctx.clearRect(0, 0, size, size);

    this.drawZodiacRing(ctx, cx, cy, outerR, innerR);
    this.drawTickMarks(ctx, cx, cy, outerR, innerR);
    this.drawSignSymbols(ctx, cx, cy, outerR, innerR);
    this.drawCrossLines(ctx, cx, cy, innerR);
    this.drawAspectLines(ctx, cx, cy, planets, planetR);
    this.drawPlanets(ctx, cx, cy, planets, planetR, innerR);
    this.drawCenterInfo(ctx, cx, cy, timestamp, perspective);
  }

  /** Draw the outer zodiac ring with element-colored wedges */
  private static drawZodiacRing(
    ctx: CanvasRenderingContext2D,
    cx: number, cy: number,
    outerR: number, innerR: number,
  ): void {
    // Background circle (neutral dark)
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(18, 18, 22, 0.92)';
    ctx.fill();

    // Inner dark area
    ctx.beginPath();
    ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(10, 10, 14, 0.95)';
    ctx.fill();

    // Sign-colored wedges (subtle tint)
    for (let i = 0; i < 12; i++) {
      const sign = ZODIAC_SIGNS[i]!;
      const startAngle = this.lonToAngle(i * 30);
      const endAngle = this.lonToAngle((i + 1) * 30);

      ctx.beginPath();
      ctx.arc(cx, cy, outerR, Math.min(startAngle, endAngle), Math.max(startAngle, endAngle));
      ctx.arc(cx, cy, innerR, Math.max(startAngle, endAngle), Math.min(startAngle, endAngle), true);
      ctx.closePath();
      // Parse hex color → rgba at low alpha
      const r = parseInt(sign.color.slice(1, 3), 16);
      const g = parseInt(sign.color.slice(3, 5), 16);
      const b = parseInt(sign.color.slice(5, 7), 16);
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.28)`;
      ctx.fill();
    }

    // Outer ring border
    ctx.beginPath();
    ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(100, 120, 150, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Inner ring border
    ctx.beginPath();
    ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(100, 120, 150, 0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Sign boundary radial lines
    for (let i = 0; i < 12; i++) {
      const angle = this.lonToAngle(i * 30);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * innerR, cy + Math.sin(angle) * innerR);
      ctx.lineTo(cx + Math.cos(angle) * outerR, cy + Math.sin(angle) * outerR);
      ctx.strokeStyle = 'rgba(100, 120, 150, 0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    ctx.restore();
  }

  /** Draw degree tick marks around the ring */
  private static drawTickMarks(
    ctx: CanvasRenderingContext2D,
    cx: number, cy: number,
    outerR: number, innerR: number,
  ): void {
    ctx.save();
    ctx.strokeStyle = 'rgba(100, 120, 150, 0.3)';

    for (let deg = 0; deg < 360; deg++) {
      const angle = this.lonToAngle(deg);
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);

      let tickLen: number;
      if (deg % 10 === 0) {
        tickLen = (outerR - innerR) * 0.35;
        ctx.lineWidth = 1;
      } else if (deg % 5 === 0) {
        tickLen = (outerR - innerR) * 0.22;
        ctx.lineWidth = 0.8;
      } else {
        tickLen = (outerR - innerR) * 0.12;
        ctx.lineWidth = 0.5;
      }

      ctx.beginPath();
      ctx.moveTo(cx + cos * innerR, cy + sin * innerR);
      ctx.lineTo(cx + cos * (innerR + tickLen), cy + sin * (innerR + tickLen));
      ctx.stroke();
    }

    ctx.restore();
  }

  /** Draw zodiac sign symbols in each 30° section */
  private static drawSignSymbols(
    ctx: CanvasRenderingContext2D,
    cx: number, cy: number,
    outerR: number, innerR: number,
  ): void {
    ctx.save();
    const midR = (outerR + innerR) / 2;
    const fontSize = (outerR - innerR) * 0.52;
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let i = 0; i < 12; i++) {
      const sign = ZODIAC_SIGNS[i]!;
      const midAngle = this.lonToAngle(i * 30 + 15); // center of sign
      const x = cx + Math.cos(midAngle) * midR;
      const y = cy + Math.sin(midAngle) * midR;

      ctx.fillStyle = sign.color;
      ctx.fillText(sign.symbol, x, y);
    }

    ctx.restore();
  }

  /** Draw subtle cross lines through center (cardinal directions) */
  private static drawCrossLines(
    ctx: CanvasRenderingContext2D,
    cx: number, cy: number,
    innerR: number,
  ): void {
    ctx.save();
    ctx.strokeStyle = 'rgba(60, 70, 90, 0.3)';
    ctx.lineWidth = 0.5;

    // Horizontal (Aries-Libra axis)
    ctx.beginPath();
    ctx.moveTo(cx - innerR, cy);
    ctx.lineTo(cx + innerR, cy);
    ctx.stroke();

    // Vertical (Cancer-Capricorn axis)
    ctx.beginPath();
    ctx.moveTo(cx, cy - innerR);
    ctx.lineTo(cx, cy + innerR);
    ctx.stroke();

    ctx.restore();
  }

  /** Draw aspect lines between planets */
  private static drawAspectLines(
    ctx: CanvasRenderingContext2D,
    cx: number, cy: number,
    planets: WheelPlanet[],
    planetR: number,
  ): void {
    ctx.save();

    for (let i = 0; i < planets.length; i++) {
      for (let j = i + 1; j < planets.length; j++) {
        const p1 = planets[i]!;
        const p2 = planets[j]!;
        let diff = Math.abs(p1.longitude - p2.longitude);
        if (diff > 180) diff = 360 - diff;

        for (const [aspectAngle, , color] of ASPECTS) {
          if (Math.abs(diff - aspectAngle) <= ASPECT_ORB) {
            const a1 = this.lonToAngle(p1.longitude);
            const a2 = this.lonToAngle(p2.longitude);

            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(a1) * planetR, cy + Math.sin(a1) * planetR);
            ctx.lineTo(cx + Math.cos(a2) * planetR, cy + Math.sin(a2) * planetR);
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            ctx.stroke();
            break; // only draw first matching aspect
          }
        }
      }
    }

    ctx.restore();
  }

  /** Draw planet dots and symbols */
  private static drawPlanets(
    ctx: CanvasRenderingContext2D,
    cx: number, cy: number,
    planets: WheelPlanet[],
    planetR: number,
    innerR: number,
  ): void {
    ctx.save();

    // Sort by longitude to handle overlap detection
    const sorted = [...planets].sort((a, b) => a.longitude - b.longitude);

    // Calculate positions with collision avoidance
    const positions: { planet: WheelPlanet; r: number; angle: number }[] = [];
    for (const planet of sorted) {
      const angle = this.lonToAngle(planet.longitude);
      let r = planetR;

      // Check for overlap with already-placed planets
      for (const placed of positions) {
        let angleDiff = Math.abs(planet.longitude - sorted.find(p => p.id === placed.planet.id)!.longitude);
        if (angleDiff > 180) angleDiff = 360 - angleDiff;
        if (angleDiff < 6 && Math.abs(r - placed.r) < 12) {
          r -= 14; // push inward
        }
      }
      r = Math.max(innerR * 0.25, r);
      positions.push({ planet, r, angle });
    }

    // Draw dots and labels
    for (const { planet, r, angle } of positions) {
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;

      // Glow effect
      const grad = ctx.createRadialGradient(x, y, 0, x, y, planet.radius * 2.5);
      grad.addColorStop(0, planet.color + '60');
      grad.addColorStop(1, 'transparent');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, planet.radius * 2.5, 0, Math.PI * 2);
      ctx.fill();

      // Planet dot
      ctx.beginPath();
      ctx.arc(x, y, planet.radius, 0, Math.PI * 2);
      ctx.fillStyle = planet.color;
      ctx.fill();

      // Planet symbol (small, offset outward from dot)
      const labelR = r + planet.radius + 8;
      const lx = cx + Math.cos(angle) * labelR;
      const ly = cy + Math.sin(angle) * labelR;
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = planet.color;
      ctx.globalAlpha = 0.85;
      ctx.fillText(planet.symbol, lx, ly);
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  /** Draw center date/time and perspective label */
  private static drawCenterInfo(
    ctx: CanvasRenderingContext2D,
    cx: number, cy: number,
    timestamp: number | null,
    perspective: string,
  ): void {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (timestamp) {
      const d = new Date(timestamp);
      const dateStr = d.toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
      });
      const timeStr = d.toLocaleTimeString('en-US', {
        hour: '2-digit', minute: '2-digit', hour12: false,
      });

      ctx.font = '11px var(--font-mono, Consolas, monospace)';
      ctx.fillStyle = 'rgba(180, 190, 210, 0.7)';
      ctx.fillText(dateStr, cx, cy - 8);
      ctx.fillText(timeStr, cx, cy + 6);
    }

    // Perspective label
    ctx.font = '9px var(--font-mono, Consolas, monospace)';
    ctx.fillStyle = 'rgba(120, 130, 150, 0.5)';
    ctx.fillText(perspective, cx, cy + 22);

    ctx.restore();
  }
}
