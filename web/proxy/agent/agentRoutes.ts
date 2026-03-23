/**
 * Express routes for the agent.
 * Endpoints:
 *   POST /agent/chat     — send message + chart state, returns SSE stream
 *   POST /agent/settings — update agent settings (provider, API key, model)
 *   GET  /agent/settings — get current settings (API key masked)
 *   GET  /agent/contexts — list contexts
 *   POST /agent/contexts — create/switch context
 *   POST /agent/mode     — toggle observation/instruct/anticipate
 *   POST /agent/clear    — clear session history
 */
import { Router, Request, Response } from 'express';
import { AgentCore } from './AgentCore.js';
import type { ChartState } from './tools/ToolRegistry.js';
import { setLatestChartState } from '../chartState.js';

export function createAgentRouter(agent: AgentCore): Router {
  const router = Router();

  /**
   * POST /agent/chat
   * Body: { sessionId, message, chartState? }
   * Returns SSE stream of agent events.
   */
  router.post('/chat', async (req: Request, res: Response) => {
    const { sessionId = 'default', message, chartState } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'message is required' });
    }

    // Cache chart state for MCP access via GET /chart/state
    if (chartState) {
      setLatestChartState(chartState);
    }

    // SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    try {
      for await (const event of agent.chat(sessionId, message, chartState as ChartState | null)) {
        const data = JSON.stringify(event);
        res.write(`data: ${data}\n\n`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.write(`data: ${JSON.stringify({ type: 'error', message: msg })}\n\n`);
    }

    res.write('data: [DONE]\n\n');
    res.end();
  });

  /**
   * POST /agent/settings
   * Body: { provider?, apiKey?, model?, ollamaUrl?, maxTokens?, temperature? }
   */
  router.post('/settings', (req: Request, res: Response) => {
    try {
      agent.configureProvider(req.body);
      res.json({ ok: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  /**
   * GET /agent/settings
   * Returns current settings with API key masked.
   */
  router.get('/settings', (_req: Request, res: Response) => {
    const settings = agent.getSettings();
    res.json({
      ...settings,
      apiKey: settings.apiKey ? '***' + settings.apiKey.slice(-4) : '',
    });
  });

  /**
   * GET /agent/contexts
   */
  router.get('/contexts', (_req: Request, res: Response) => {
    const cm = agent.getContextManager();
    const contexts = cm.listContexts();
    const activeId = cm.getActiveContextId();
    res.json({ contexts, activeContextId: activeId });
  });

  /**
   * POST /agent/contexts
   * Body: { action: 'create' | 'switch', name?, description?, contextId? }
   */
  router.post('/contexts', (req: Request, res: Response) => {
    const { action, name, description, contextId } = req.body;
    const cm = agent.getContextManager();

    try {
      if (action === 'create') {
        if (!name) return res.status(400).json({ error: 'name is required' });
        const ctx = cm.createContext(name, description || '');
        res.json({ context: ctx });
      } else if (action === 'switch') {
        if (!contextId) return res.status(400).json({ error: 'contextId is required' });
        const ctx = cm.switchContext(contextId);
        res.json({ context: ctx });
      } else {
        res.status(400).json({ error: 'action must be "create" or "switch"' });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: msg });
    }
  });

  /**
   * POST /agent/mode
   * Body: { contextId?, observe?, instruct?, anticipate? }
   */
  router.post('/mode', (req: Request, res: Response) => {
    const cm = agent.getContextManager();
    const contextId = req.body.contextId || cm.getActiveContextId();
    if (!contextId) {
      return res.status(400).json({ error: 'No active context. Create one first.' });
    }

    try {
      const modes: Record<string, boolean> = {};
      if (typeof req.body.observe === 'boolean') modes.observe = req.body.observe;
      if (typeof req.body.instruct === 'boolean') modes.instruct = req.body.instruct;
      if (typeof req.body.anticipate === 'boolean') modes.anticipate = req.body.anticipate;

      const ctx = cm.updateModes(contextId, modes);
      res.json({ context: ctx });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: msg });
    }
  });

  /**
   * POST /agent/clear
   * Body: { sessionId }
   */
  router.post('/clear', (req: Request, res: Response) => {
    const { sessionId = 'default' } = req.body;
    agent.clearSession(sessionId);
    res.json({ ok: true });
  });

  return router;
}
