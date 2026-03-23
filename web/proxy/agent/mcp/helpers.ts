/**
 * Shared helpers for MCP domain modules.
 * HTTP helpers for calling the Express server, plus URI parsing utilities.
 */

export const EXPRESS_URL = 'http://127.0.0.1:5050';

/** GET request to Express server. Returns parsed JSON or null on failure. */
export async function fetchExpress(urlPath: string): Promise<unknown | null> {
  try {
    const res = await fetch(`${EXPRESS_URL}${urlPath}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** POST request to Express server. Returns parsed JSON, error object, or null. */
export async function fetchExpressPost(urlPath: string, body: unknown): Promise<unknown | null> {
  try {
    const res = await fetch(`${EXPRESS_URL}${urlPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      try { return JSON.parse(text); } catch { return { error: text || `HTTP ${res.status}` }; }
    }
    return await res.json();
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/** DELETE request to Express server. */
export async function fetchExpressDelete(urlPath: string): Promise<unknown | null> {
  try {
    const res = await fetch(`${EXPRESS_URL}${urlPath}`, { method: 'DELETE' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Format a result as JSON string, with fallback error message. */
export function jsonResult(data: unknown, fallbackError: string): string {
  if (data === null) return fallbackError;
  return JSON.stringify(data, null, 2);
}

/** Parse a ultrachart:// URI and extract path segments. */
export function parseUri(uri: string): string[] {
  // ultrachart://account/summary → ['account', 'summary']
  const match = uri.match(/^ultrachart:\/\/(.+)$/);
  if (!match) return [];
  return match[1].split('/').map(decodeURIComponent);
}

/** Build a resource content response. */
export function resourceJson(uri: string, data: unknown): { uri: string; mimeType: string; text: string }[] {
  return [{
    uri,
    mimeType: 'application/json',
    text: JSON.stringify(data, null, 2),
  }];
}
