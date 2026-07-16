import { afterEach, describe, it, expect, vi } from 'vitest';
import { fetchSyncJson, normalizeSyncBaseUrl } from '../../lib/utils.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

// 直接复制测试函数，避免依赖 webextension-polyfill
function escapeHtml(value: unknown): string {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

function normalizeContextValue(context: unknown): string {
  return String(context || "").trim().replace(/\s+/g, " ");
}

function normalizeSourceLinkValue(context: { sourceLink?: string; source_link?: string; sourceUrl?: string; source_url?: string }): string {
  const raw = String(
    context?.sourceLink ||
    context?.source_link ||
    context?.sourceUrl ||
    context?.source_url ||
    ""
  ).trim();
  try {
    const url = new URL(raw);
    url.hash = '';
    return url.toString();
  } catch {
    return raw;
  }
}

describe('normalizeSyncBaseUrl', () => {
  it('normalizes HTTPS and local HTTP URLs', () => {
    expect(normalizeSyncBaseUrl(' https://example.com/api/// ')).toBe('https://example.com/api');
    expect(normalizeSyncBaseUrl('http://localhost:3001/')).toBe('http://localhost:3001');
    expect(normalizeSyncBaseUrl('http://127.0.0.1:3001/')).toBe('http://127.0.0.1:3001');
    expect(normalizeSyncBaseUrl('http://[::1]:3001/')).toBe('http://[::1]:3001');
  });

  it('rejects insecure remote and malformed URLs', () => {
    const fallback = 'https://fallback.example.com';
    expect(normalizeSyncBaseUrl('http://example.com', fallback)).toBe(fallback);
    expect(normalizeSyncBaseUrl('ftp://localhost/resource', fallback)).toBe(fallback);
    expect(normalizeSyncBaseUrl('not-a-url', fallback)).toBe(fallback);
    expect(normalizeSyncBaseUrl('', fallback)).toBe(fallback);
  });

  it('does not allow localhost lookalike hosts', () => {
    const fallback = 'https://fallback.example.com';
    expect(normalizeSyncBaseUrl('http://localhost.example.com', fallback)).toBe(fallback);
    expect(normalizeSyncBaseUrl('http://127.0.0.2:3001', fallback)).toBe(fallback);
  });
});

describe('fetchSyncJson', () => {
  it('should parse a successful JSON response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([{ id: 'book-1' }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      })
    );

    await expect(fetchSyncJson('https://example.com/api/v1/books')).resolves.toEqual([{ id: 'book-1' }]);
  });

  it('should reject HTML responses without exposing the body', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('<!doctype html><html>secret page</html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    );

    await expect(fetchSyncJson('https://example.com/api/v1/books'))
      .rejects.toThrow('sync_invalid_response_200_text/html; charset=utf-8');
  });

  it('should map unauthorized responses to the refresh signal', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await expect(fetchSyncJson('https://example.com/api/v1/books')).rejects.toThrow('unauthorized');
  });

  it('should reject non-success status without parsing the body', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('<!doctype html>', {
        status: 502,
        headers: { 'Content-Type': 'text/html' },
      })
    );

    await expect(fetchSyncJson('https://example.com/api/v1/books')).rejects.toThrow('sync_http_502');
  });

  it('should reject invalid JSON responses', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('{invalid', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await expect(fetchSyncJson('https://example.com/api/v1/books')).rejects.toThrow('sync_invalid_json_200');
  });

  it('should abort requests after the timeout', async () => {
    globalThis.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      })
    );

    await expect(fetchSyncJson('https://example.com/api/v1/books', {}, 1))
      .rejects.toThrow('sync_request_timeout');
  });
});

describe('escapeHtml', () => {
  it('should escape special characters', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  });

  it('should handle ampersand', () => {
    expect(escapeHtml('A & B')).toBe('A &amp; B');
  });

  it('should handle single quotes', () => {
    expect(escapeHtml("it's")).toBe('it&#39;s');
  });

  it('should handle null/undefined', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });
});

describe('clampNumber', () => {
  it('should clamp within range', () => {
    expect(clampNumber(150, 0, 100, 50)).toBe(100);
    expect(clampNumber(-10, 0, 100, 50)).toBe(0);
    expect(clampNumber(50, 0, 100, 50)).toBe(50);
  });

  it('should return fallback for invalid values', () => {
    expect(clampNumber('abc', 0, 100, 42)).toBe(42);
    // null -> Number(null) = 0, which is finite, clamped to 0
    expect(clampNumber(null, 0, 100, 10)).toBe(0);
  });
});

describe('normalizeContextValue', () => {
  it('should trim and collapse whitespace', () => {
    expect(normalizeContextValue('  hello   world  ')).toBe('hello world');
  });

  it('should handle null/undefined', () => {
    expect(normalizeContextValue(null)).toBe('');
    expect(normalizeContextValue(undefined)).toBe('');
  });
});

describe('normalizeSourceLinkValue', () => {
  it('should remove URL fragments', () => {
    expect(normalizeSourceLinkValue({ sourceUrl: 'https://example.com/page#:~:text=hello' }))
      .toBe('https://example.com/page');
  });

  it('should handle invalid URLs', () => {
    expect(normalizeSourceLinkValue({ sourceLink: 'not-a-url' })).toBe('not-a-url');
  });
});
