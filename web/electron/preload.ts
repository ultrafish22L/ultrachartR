/**
 * UltraChart — Electron Preload Script
 *
 * Minimal — all communication goes through HTTP to the embedded Express server.
 */
import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('ultrachart', {
  platform: 'electron',
});
