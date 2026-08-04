import { describe, it, expect } from 'vitest';

import {
  DEFAULT_LOOKUP_KEY,
  normalizeLookupKeys,
  detectWordLanguage,
  buildWordPattern,
  extractSentence,
  computeWordSignature,
  LANG_LABELS,
  LANG_SHORT_LABELS,
} from '../../lib/content-helpers.js';

describe('normalizeLookupKeys', () => {
  it('returns default when input is null/undefined', () => {
    expect(normalizeLookupKeys(null)).toEqual({ mac: DEFAULT_LOOKUP_KEY, win: DEFAULT_LOOKUP_KEY });
    expect(normalizeLookupKeys(undefined)).toEqual({ mac: DEFAULT_LOOKUP_KEY, win: DEFAULT_LOOKUP_KEY });
    expect(normalizeLookupKeys({})).toEqual({ mac: DEFAULT_LOOKUP_KEY, win: DEFAULT_LOOKUP_KEY });
  });

  it('migrates legacy single lookupKey to both platforms', () => {
    expect(normalizeLookupKeys({ lookupKey: 'Meta' })).toEqual({ mac: 'Meta', win: 'Meta' });
  });

  it('prefers explicit per-platform lookupKeys', () => {
    expect(normalizeLookupKeys({ lookupKeys: { mac: 'Control', win: 'Alt' } })).toEqual({
      mac: 'Control',
      win: 'Alt',
    });
  });

  it('falls back per platform when one side missing', () => {
    expect(normalizeLookupKeys({ lookupKeys: { mac: 'Meta' } })).toEqual({
      mac: 'Meta',
      win: DEFAULT_LOOKUP_KEY,
    });
  });

  it('does not mutate the input object', () => {
    const raw: Record<string, unknown> = { lookupKey: 'Shift' };
    normalizeLookupKeys(raw);
    expect(raw.lookupKeys).toBeUndefined();
  });
});

describe('detectWordLanguage', () => {
  it('detects Japanese by kana/kanji', () => {
    expect(detectWordLanguage('日本語')).toBe('ja');
    expect(detectWordLanguage('こんにちは')).toBe('ja');
  });

  it('detects Korean by hangul', () => {
    expect(detectWordLanguage('안녕하세요')).toBe('ko');
  });

  it('detects Spanish by feature chars', () => {
    expect(detectWordLanguage('español')).toBe('es');
    expect(detectWordLanguage('niño')).toBe('es');
  });

  it('detects French by feature chars', () => {
    expect(detectWordLanguage('café')).toBe('fr');
    expect(detectWordLanguage('naïf')).toBe('fr');
  });

  it('defaults to English', () => {
    expect(detectWordLanguage('hello')).toBe('en');
    expect(detectWordLanguage('world')).toBe('en');
  });
});

describe('buildWordPattern', () => {
  it('returns a global RegExp', () => {
    const pattern = buildWordPattern(['en']);
    expect(pattern.global).toBe(true);
    expect(pattern.test('Hello')).toBe(true);
  });

  it('combines multiple languages', () => {
    const pattern = buildWordPattern(['en', 'fr']);
    expect(pattern.source).toContain('|');
  });

  it('falls back to english-only when list is empty', () => {
    const pattern = buildWordPattern([]);
    expect(pattern.global).toBe(true);
    expect(pattern.test('Hello')).toBe(true);
  });
});

describe('extractSentence', () => {
  it('returns a centered slice around the word', () => {
    const text = 'The quick brown fox jumps over the lazy dog';
    const result = extractSentence(text, 'fox');
    expect(result).toContain('fox');
    expect(result.length).toBeLessThanOrEqual(text.length);
  });

  it('falls back to head slice when word not found', () => {
    const text = 'Some long text without the target token present here at all';
    const result = extractSentence(text, 'missing');
    expect(result.startsWith('Some')).toBe(true);
    expect(result.length).toBeLessThanOrEqual(120);
  });

  it('handles empty word gracefully', () => {
    const text = 'Short text';
    expect(() => extractSentence(text)).not.toThrow();
  });
});

describe('computeWordSignature', () => {
  it('normalizes word to lowercase for stable comparison', () => {
    expect(computeWordSignature('Hello', 1, 2, 'text')).toBe('hello|1|2|text');
  });

  it('normalizes word case while preserving the source text verbatim', () => {
    const mixed = computeWordSignature('Word', 0, 4, 'The Word sits here');
    const lower = computeWordSignature('word', 0, 4, 'The Word sits here');
    expect(mixed).toBe(lower);
    expect(mixed).toBe('word|0|4|The Word sits here');
  });
});

describe('language label maps', () => {
  it('LANG_LABELS covers the supported languages', () => {
    expect(LANG_LABELS.en).toBe('英语');
    expect(LANG_LABELS.ja).toBe('日语');
  });

  it('LANG_SHORT_LABELS covers the supported languages', () => {
    expect(LANG_SHORT_LABELS.en).toBe('[英]');
    expect(LANG_SHORT_LABELS.ja).toBe('[日]');
  });
});
