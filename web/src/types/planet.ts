import { Point } from './chart';
import { ChartObjectBase } from './objects';

/** Planet identifiers - matches Swiss Ephemeris SE_* constants */
export enum PlanetId {
  Sun = 0,
  Moon = 1,
  Mercury = 2,
  Venus = 3,
  Mars = 4,
  Jupiter = 5,
  Saturn = 6,
  Uranus = 7,
  Neptune = 8,
  Pluto = 9,
  MeanNode = 10,   // North Node (Mean)
  TrueNode = 11,   // North Node (True)
  MeanApog = 12,    // Lilith (Mean)
  Chiron = 15,
}

/** Coordinate type for planetary position */
export type PlanetCoordinate = 'longitude' | 'latitude' | 'declination' | 'rightAscension';

/** Perspective/coordinate system for planet calculation */
export type PlanetPerspective = 'heliocentric' | 'geocentric' | 'topocentric';

/** Ephemeris configuration - mirrors legacy cEphemData */
export interface EphemConfig {
  planet: PlanetId;
  /** Observer latitude */
  latitude: number;
  /** Observer longitude */
  longitude: number;
  /** Observer elevation in meters */
  elevation: number;
  /** GMT offset hours */
  gmtOffset: number;
  /** Coordinate system perspective */
  perspective: PlanetPerspective;
  /** Which coordinate to use */
  coordinate: PlanetCoordinate;
}

/** Planet line configuration */
export interface PlanetLineConfig extends EphemConfig {
  /** Angular period for line spacing (degrees between repeated lines) */
  period: number;
  /** Price offset (F0) — shifts lines vertically on the price axis */
  offset: number;
  /** Invert direction */
  invert: boolean;
  /** Show vertical lines at key aspects */
  showVertLines: boolean;
  /** Show aspect bands */
  showBands: boolean;
}

/** Planet line chart object */
export interface PlanetLineObject extends ChartObjectBase {
  type: 'planetLine';
  config: PlanetLineConfig;
  /** Cached sample points: x=timestamp, y=raw accumulated angle (degrees) */
  samples: Point[];
  /** Whether cache needs recalculation */
  dirty: boolean;
}

/** Default ephemeris config */
export const DEFAULT_EPHEM_CONFIG: EphemConfig = {
  planet: PlanetId.Sun,
  latitude: 34.02,
  longitude: -118.45,
  elevation: 22,
  gmtOffset: -8,
  perspective: 'heliocentric',
  coordinate: 'longitude',
};

/** Planet display info */
export interface PlanetInfo {
  id: PlanetId;
  name: string;
  symbol: string;
  defaultColor: string;
}

/** All planet info for UI display — colors match legacy C++ UltraChart (ephem.cpp) */
export const PLANETS: PlanetInfo[] = [
  { id: PlanetId.Sun, name: 'Sun', symbol: '\u2609', defaultColor: '#f0e200' },       // Yellow (0.94, 0.89, 0)
  { id: PlanetId.Moon, name: 'Moon', symbol: '\u263D', defaultColor: '#bfbfbf' },      // Gray (0.75, 0.75, 0.75)
  { id: PlanetId.Mercury, name: 'Mercury', symbol: '\u263F', defaultColor: '#ff00ff' }, // Magenta (1, 0, 1)
  { id: PlanetId.Venus, name: 'Venus', symbol: '\u2640', defaultColor: '#00ffff' },    // Cyan (0, 1, 1)
  { id: PlanetId.Mars, name: 'Mars', symbol: '\u2642', defaultColor: '#ff0000' },      // Red (1, 0, 0)
  { id: PlanetId.Jupiter, name: 'Jupiter', symbol: '\u2643', defaultColor: '#0000e6' }, // Blue (0, 0, 0.9)
  { id: PlanetId.Saturn, name: 'Saturn', symbol: '\u2644', defaultColor: '#00e600' },   // Green (0, 0.9, 0)
  { id: PlanetId.Uranus, name: 'Uranus', symbol: '\u2645', defaultColor: '#008000' },   // Dark green (0, 0.5, 0)
  { id: PlanetId.Neptune, name: 'Neptune', symbol: '\u2646', defaultColor: '#008080' }, // Teal (0, 0.5, 0.5)
  { id: PlanetId.Pluto, name: 'Pluto', symbol: '\u2647', defaultColor: '#808080' },    // Gray (0.5, 0.5, 0.5)
  { id: PlanetId.MeanNode, name: 'North Node', symbol: '\u260A', defaultColor: '#800000' }, // Dark red (0.5, 0, 0)
  { id: PlanetId.Chiron, name: 'Chiron', symbol: '\u26B7', defaultColor: '#808000' },  // Olive (0.5, 0.5, 0)
];
