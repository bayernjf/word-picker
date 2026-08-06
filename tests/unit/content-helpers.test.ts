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

describe('detectWordLanguage — all supported languages', () => {
  it('detects English for plain Latin words', () => {
    expect(detectWordLanguage('hello')).toBe('en');
    expect(detectWordLanguage('world')).toBe('en');
  });

  it('detects French by accented feature chars', () => {
    expect(detectWordLanguage('café')).toBe('fr');
    expect(detectWordLanguage('naïf')).toBe('fr');
    expect(detectWordLanguage('garçon')).toBe('fr');
  });

  it('detects Spanish by ñ / ¿ / ¡', () => {
    expect(detectWordLanguage('español')).toBe('es');
    expect(detectWordLanguage('niño')).toBe('es');
  });

  it('detects German by umlauts / ß', () => {
    // 仅含变音符号/ß 的德语词可经字符特征识别；纯拉丁字母德语词（如 Schmetterling）
    // 与英/法/西无变音词无法区分，按设计回退为 en（与法语/西语纯字母词一致）。
    expect(detectWordLanguage('Über')).toBe('de');
    expect(detectWordLanguage('über')).toBe('de');
    expect(detectWordLanguage('Straße')).toBe('de');
    expect(detectWordLanguage('Größe')).toBe('de');
    expect(detectWordLanguage('Mädchen')).toBe('de');
    expect(detectWordLanguage('Tür')).toBe('de');
    expect(detectWordLanguage('Schön')).toBe('de');
  });

  it('plain German words without umlauts fall back to en (consistent with fr/es)', () => {
    expect(detectWordLanguage('Schmetterling')).toBe('en');
    expect(detectWordLanguage('Haus')).toBe('en');
  });

  it('detects Korean by hangul', () => {
    expect(detectWordLanguage('안녕하세요')).toBe('ko');
    expect(detectWordLanguage('한국어')).toBe('ko');
  });

  it('detects Japanese by kana/kanji', () => {
    expect(detectWordLanguage('こんにちは')).toBe('ja');
    expect(detectWordLanguage('日本語')).toBe('ja');
    expect(detectWordLanguage('ありがとう')).toBe('ja');
  });
});

describe('buildWordPattern — multi-language hover pickup', () => {
  // Mirrors detectWordAtPoint's Latin-script branch: return the LONGEST match containing the caret offset.
  function pickAtOffset(text: string, offset: number, languages: string[]): string | null {
    const re = buildWordPattern(languages);
    let best: string | null = null;
    for (const m of text.matchAll(re)) {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      if (offset >= start && offset <= end && (!best || m[0].length > best.length)) best = m[0];
    }
    return best;
  }

  it('de-only pattern matches full German words (umlauts / ß)', () => {
    const re = buildWordPattern(['de']);
    expect('Schön'.match(re)?.[0]).toBe('Schön');
    expect('Größe'.match(re)?.[0]).toBe('Größe');
    expect('Straße'.match(re)?.[0]).toBe('Straße');
  });

  it('single-language patterns pick up the full accented word', () => {
    expect('café'.match(buildWordPattern(['fr']))?.[0]).toBe('café');
    expect('niño'.match(buildWordPattern(['es']))?.[0]).toBe('niño');
    expect('Schön'.match(buildWordPattern(['de']))?.[0]).toBe('Schön');
  });

  it('de-only picks up the full German word once de is enabled', () => {
    const text = 'Ein Schön Wort';
    expect(pickAtOffset(text, text.indexOf('Schön') + 2, ['de'])).toBe('Schön');
  });

  it('Korean pattern matches a full hangul sequence', () => {
    expect('안녕하세요'.match(buildWordPattern(['ko']))?.[0]).toBe('안녕하세요');
  });

  it('en + accented languages does NOT fragment words (en placed last)', () => {
    // 回归：en 与 fr/es/de 同开时，组合正则必须整词匹配，不能拆成 ASCII 前缀 + 变音后缀。
    expect([... 'niño'.matchAll(buildWordPattern(['en', 'es']))].map((m) => m[0])).toEqual(['niño']);
    expect([... 'café'.matchAll(buildWordPattern(['en', 'fr']))].map((m) => m[0])).toEqual(['café']);
    expect([... 'Schön'.matchAll(buildWordPattern(['en', 'de']))].map((m) => m[0])).toEqual(['Schön']);
    expect(pickAtOffset('Le niño ist Schön', 6, ['en', 'fr', 'es', 'de'])).toBe('niño');
    expect(pickAtOffset('Le niño ist Schön', 15, ['en', 'fr', 'es', 'de'])).toBe('Schön');
  });
});
