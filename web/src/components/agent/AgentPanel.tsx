/**
 * Agent chat panel — floating window UI for the AI trading assistant.
 * Handles chat input, message display, settings, mode toggles, and context switching.
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import styles from './AgentPanel.module.css';

// ── Types ──

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'error';
  content: string;
  toolName?: string;
}

interface AgentContext {
  id: string;
  name: string;
  description: string;
  modes: { observe: boolean; instruct: boolean; anticipate: boolean };
  hasObservationConfig: boolean;
  active: boolean;
}

interface AgentSettings {
  provider: string;
  apiKey: string;
  model: string;
  ollamaUrl: string;
  maxTokens: number;
  temperature: number;
}

// ── Component ──

export function AgentPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [contexts, setContexts] = useState<AgentContext[]>([]);
  const [activeContextId, setActiveContextId] = useState<string | null>(null);
  const [settings, setSettings] = useState<AgentSettings>({
    provider: 'claude', apiKey: '', model: 'claude-sonnet-4-20250514',
    ollamaUrl: 'http://localhost:11434', maxTokens: 4096, temperature: 0.7,
  });
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const sessionId = useRef(`session-${Date.now()}`);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Load settings + contexts on mount
  useEffect(() => {
    fetchSettings();
    fetchContexts();
  }, []);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch('/agent/settings');
      if (res.ok) {
        const data = await res.json();
        setSettings(data);
      }
    } catch { /* server not running */ }
  }, []);

  const fetchContexts = useCallback(async () => {
    try {
      const res = await fetch('/agent/contexts');
      if (res.ok) {
        const data = await res.json();
        setContexts(data.contexts);
        setActiveContextId(data.activeContextId);
      }
    } catch { /* server not running */ }
  }, []);

  const saveSettings = useCallback(async () => {
    try {
      await fetch('/agent/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      setShowSettings(false);
      fetchSettings();
    } catch (err) {
      console.error('Failed to save settings:', err);
    }
  }, [settings, fetchSettings]);

  const toggleMode = useCallback(async (mode: 'observe' | 'instruct' | 'anticipate') => {
    const ctx = contexts.find((c) => c.id === activeContextId);
    if (!ctx) return;
    try {
      await fetch('/agent/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [mode]: !ctx.modes[mode] }),
      });
      fetchContexts();
    } catch (err) {
      console.error('Failed to toggle mode:', err);
    }
  }, [contexts, activeContextId, fetchContexts]);

  const switchContext = useCallback(async (contextId: string) => {
    try {
      await fetch('/agent/contexts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'switch', contextId }),
      });
      fetchContexts();
    } catch (err) {
      console.error('Failed to switch context:', err);
    }
  }, [fetchContexts]);

  const clearChat = useCallback(async () => {
    setMessages([]);
    try {
      await fetch('/agent/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sessionId.current }),
      });
    } catch { /* ignore */ }
  }, []);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isStreaming) return;

    setInput('');
    setIsStreaming(true);

    // Add user message
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
    };
    setMessages((prev) => [...prev, userMsg]);

    // Build chart state from the main window (opener)
    let chartState = null;
    try {
      // Try opener (popup window) first, then current window (embedded mode)
      const opener = (window as any).opener;
      const getter = opener?.__ultrachart_getChartState || (window as any).__ultrachart_getChartState;
      if (getter) chartState = getter();
    } catch { /* cross-origin or no chart state available */ }

    // Stream response via SSE
    const assistantId = `assistant-${Date.now()}`;
    let assistantText = '';

    try {
      const res = await fetch('/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: sessionId.current,
          message: text,
          chartState,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Request failed' }));
        setMessages((prev) => [...prev, {
          id: `error-${Date.now()}`,
          role: 'error',
          content: err.error || 'Request failed',
        }]);
        setIsStreaming(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            const event = JSON.parse(data);

            if (event.type === 'text') {
              assistantText += event.content;
              setMessages((prev) => {
                const existing = prev.find((m) => m.id === assistantId);
                if (existing) {
                  return prev.map((m) => m.id === assistantId ? { ...m, content: assistantText } : m);
                }
                return [...prev, { id: assistantId, role: 'assistant', content: assistantText }];
              });
            } else if (event.type === 'tool_call') {
              setMessages((prev) => [...prev, {
                id: `tool-${Date.now()}-${Math.random()}`,
                role: 'tool',
                content: `${event.name}(${JSON.stringify(event.input).slice(0, 100)})`,
                toolName: event.name,
              }]);
            } else if (event.type === 'error') {
              setMessages((prev) => [...prev, {
                id: `error-${Date.now()}`,
                role: 'error',
                content: event.message,
              }]);
            }
          } catch { /* skip malformed SSE data */ }
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setMessages((prev) => [...prev, {
        id: `error-${Date.now()}`,
        role: 'error',
        content: `Connection error: ${msg}`,
      }]);
    }

    setIsStreaming(false);
    inputRef.current?.focus();
  }, [input, isStreaming]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }, [sendMessage]);

  const activeCtx = contexts.find((c) => c.id === activeContextId);

  return (
    <div className={styles.panel}>
      {/* Header */}
      <div className={styles.header}>
        <div>
          <span className={styles.headerTitle}>Agent</span>
          {activeCtx && (
            <select
              className={styles.contextSelect}
              value={activeContextId || ''}
              onChange={(e) => switchContext(e.target.value)}
            >
              {contexts.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
          {!activeCtx && <span className={styles.headerContext}>No context</span>}
        </div>
        <div className={styles.headerActions}>
          <button className={styles.iconBtn} onClick={clearChat} title="Clear chat">&#x1F5D1;</button>
          <button
            className={styles.iconBtn}
            onClick={() => setShowSettings(!showSettings)}
            title="Settings"
          >&#x2699;</button>
        </div>
      </div>

      {/* Mode toggles (only when a context is active) */}
      {activeCtx && (
        <div className={styles.modes}>
          <button
            className={`${styles.modeBtn} ${activeCtx.modes.observe ? styles.modeBtnActive : ''}`}
            onClick={() => toggleMode('observe')}
          >Observe</button>
          <button
            className={`${styles.modeBtn} ${activeCtx.modes.instruct ? styles.modeBtnActive : ''}`}
            onClick={() => toggleMode('instruct')}
          >Instruct</button>
          <button
            className={`${styles.modeBtn} ${activeCtx.modes.anticipate ? styles.modeBtnActive : ''}`}
            onClick={() => toggleMode('anticipate')}
          >Anticipate</button>
        </div>
      )}

      {/* Settings panel */}
      {showSettings && (
        <div className={styles.settings}>
          <div className={styles.settingsRow}>
            <span className={styles.settingsLabel}>Provider</span>
            <select
              className={styles.settingsSelect}
              value={settings.provider}
              onChange={(e) => setSettings({ ...settings, provider: e.target.value })}
            >
              <option value="claude">Claude (Anthropic)</option>
              <option value="openai">OpenAI</option>
              <option value="ollama">Ollama (Local)</option>
            </select>
          </div>
          <div className={styles.settingsRow}>
            <span className={styles.settingsLabel}>API Key</span>
            <input
              className={styles.settingsInput}
              type="password"
              value={settings.apiKey}
              onChange={(e) => setSettings({ ...settings, apiKey: e.target.value })}
              placeholder="sk-ant-..."
            />
          </div>
          <div className={styles.settingsRow}>
            <span className={styles.settingsLabel}>Model</span>
            <input
              className={styles.settingsInput}
              value={settings.model}
              onChange={(e) => setSettings({ ...settings, model: e.target.value })}
              placeholder="claude-sonnet-4-20250514"
            />
          </div>
          <div className={styles.settingsRow}>
            <span className={styles.settingsLabel}></span>
            <button className={styles.settingsSave} onClick={saveSettings}>Save</button>
          </div>
        </div>
      )}

      {/* Messages */}
      <div className={styles.messages}>
        {messages.length === 0 && (
          <div className={styles.empty}>
            Configure your API key in settings, then start chatting.<br />
            Say "create a new context for X" to begin learning.
          </div>
        )}
        {messages.map((msg) => {
          if (msg.role === 'tool') {
            return (
              <div key={msg.id} className={styles.toolCall}>
                <span className={styles.toolName}>{msg.toolName}</span> {msg.content}
              </div>
            );
          }
          return (
            <div
              key={msg.id}
              className={`${styles.message} ${
                msg.role === 'user' ? styles.messageUser :
                msg.role === 'error' ? styles.messageError :
                styles.messageAssistant
              }`}
            >
              {msg.content}
              {isStreaming && msg.role === 'assistant' && msg === messages[messages.length - 1] && (
                <span className={styles.typing} />
              )}
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className={styles.inputArea}>
        <textarea
          ref={inputRef}
          className={styles.input}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about the chart, teach a technique, or give instructions..."
          rows={1}
          disabled={isStreaming}
        />
        <button
          className={styles.sendBtn}
          onClick={sendMessage}
          disabled={isStreaming || !input.trim()}
        >
          Send
        </button>
      </div>
    </div>
  );
}
