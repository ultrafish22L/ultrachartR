/**
 * Entry point for the agent floating window.
 * Loads theme from URL params and renders the agent panel.
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { AgentPanel } from './components/agent/AgentPanel';
import './styles/global.css';

// Apply theme from URL param (synced from main window)
const params = new URLSearchParams(window.location.search);
const theme = params.get('theme');
if (theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AgentPanel />
  </React.StrictMode>,
);
