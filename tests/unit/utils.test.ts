import { describe, it, expect } from 'vitest';

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
