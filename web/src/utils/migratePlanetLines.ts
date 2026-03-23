/**
 * Migrate planet line configs from old schema (amplitude/heliocentric)
 * to new schema (offset/perspective).
 */
import type { PlanetLineObject } from '../types/planet';

export function migratePlanetLines(pls: PlanetLineObject[]): PlanetLineObject[] {
  return pls.map((pl) => {
    const cfg = { ...pl.config } as any;
    if ('amplitude' in cfg && !('offset' in cfg)) {
      cfg.offset = 0;
      delete cfg.amplitude;
    }
    if ('heliocentric' in cfg && !('perspective' in cfg)) {
      cfg.perspective = cfg.heliocentric ? 'heliocentric' : 'geocentric';
      delete cfg.heliocentric;
    }
    return { ...pl, config: cfg, dirty: true };
  });
}
