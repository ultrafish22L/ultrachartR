/**
 * Standalone agent window entry point.
 * Rendered at /agent.html — opened as a popup or Electron BrowserWindow.
 * Inherits theme from the main window via URL param.
 */
import { AgentPanel } from './AgentPanel';

export function AgentWindow() {
  return <AgentPanel />;
}
