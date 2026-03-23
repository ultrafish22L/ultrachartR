/**
 * Express routes for Astro Engine operations.
 *
 * Mounted at /astro — provides REST endpoints for engine lifecycle,
 * training, scoring, phase curves, and profile management.
 */

import { Router, Request, Response } from 'express';
import type { AstroService } from './services/AstroService.js';

export function createAstroRouter(astro: AstroService): Router {
  const router = Router();

  // ── Engine lifecycle ───────────────────────────────────────────

  router.get('/status', (_req: Request, res: Response) => {
    res.json(astro.getStatus());
  });

  router.post('/start', async (_req: Request, res: Response) => {
    try {
      await astro.start();
      res.json({ ok: true });
    } catch (err: unknown) {
      res.status(500).json({ error: msg(err) });
    }
  });

  router.post('/stop', async (_req: Request, res: Response) => {
    try {
      await astro.stop();
      res.json({ ok: true });
    } catch (err: unknown) {
      res.status(500).json({ error: msg(err) });
    }
  });

  // ── Training ───────────────────────────────────────────────────

  /**
   * POST /astro/train
   * Body: { cachePath, symbol, interval?, observer?, curvesFilter?, tag? }
   */
  router.post('/train', async (req: Request, res: Response) => {
    const { cachePath, symbol, interval, observer, curvesFilter, tag } = req.body;

    if (!cachePath || !symbol) {
      return res.status(400).json({ error: 'cachePath and symbol are required' });
    }

    try {
      const result = await astro.train(cachePath, symbol, interval, observer, tag, curvesFilter);
      res.json(result);
    } catch (err: unknown) {
      res.status(500).json({ error: msg(err) });
    }
  });

  /**
   * POST /astro/backtest
   * Body: { profileId, cachePath }
   */
  router.post('/backtest', async (req: Request, res: Response) => {
    const { profileId, cachePath } = req.body;

    if (!profileId || !cachePath) {
      return res.status(400).json({ error: 'profileId and cachePath are required' });
    }

    try {
      const result = await astro.backtest(profileId, cachePath);
      res.json(result);
    } catch (err: unknown) {
      res.status(500).json({ error: msg(err) });
    }
  });

  // ── Scoring ────────────────────────────────────────────────────

  /**
   * POST /astro/score
   * Body: { profileId, at?, observer? }
   */
  router.post('/score', async (req: Request, res: Response) => {
    const { profileId, at, observer } = req.body;

    if (!profileId) {
      return res.status(400).json({ error: 'profileId is required' });
    }

    try {
      const atDate = at ? new Date(at) : undefined;
      const result = await astro.score(profileId, atDate, observer);
      res.json(result);
    } catch (err: unknown) {
      res.status(500).json({ error: msg(err) });
    }
  });

  // ── Phase Curves ───────────────────────────────────────────────

  /**
   * POST /astro/phase-curves
   * Body: { start, end, intervalMinutes?, observer? }
   */
  router.post('/phase-curves', async (req: Request, res: Response) => {
    const { start, end, intervalMinutes, observer } = req.body;

    if (!start || !end) {
      return res.status(400).json({ error: 'start and end are required' });
    }

    try {
      const result = await astro.getPhaseCurves(
        new Date(start),
        new Date(end),
        intervalMinutes,
        observer,
      );
      res.json(result);
    } catch (err: unknown) {
      res.status(500).json({ error: msg(err) });
    }
  });

  // ── Profile CRUD ───────────────────────────────────────────────

  router.get('/profiles', (_req: Request, res: Response) => {
    res.json(astro.listProfiles());
  });

  router.get('/profiles/:id', (req: Request, res: Response) => {
    const profile = astro.getProfile(req.params.id);
    if (!profile) return res.status(404).json({ error: 'Profile not found' });
    res.json(profile);
  });

  router.delete('/profiles/:id', (req: Request, res: Response) => {
    const deleted = astro.deleteProfile(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Profile not found' });
    res.json({ ok: true });
  });

  router.post('/profiles/:id/activate', (req: Request, res: Response) => {
    try {
      const result = astro.activateProfile(req.params.id);
      res.json({ ok: true, ...result });
    } catch (err: unknown) {
      res.status(400).json({ error: msg(err) });
    }
  });

  return router;
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
