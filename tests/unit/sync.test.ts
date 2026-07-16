import { describe, it, expect } from 'vitest';

function normalizeWordValue(word: unknown): string {
  return String(word || '').trim().toLowerCase();
}

function normalizeBookValue(bookId: unknown): string {
  const trimmed = String(bookId || '').trim();
  return trimmed || '__sync_book__';
}

function getQueuedWordKey(entry: { word?: string; bookId?: string }): string {
  return `${normalizeWordValue(entry?.word)}::${normalizeBookValue(entry?.bookId)}`;
}

function lowercaseFirstLetter(word: string): string {
  const text = String(word || '');
  if (!text) {
    return text;
  }
  if (!/^[A-Za-z][A-Za-z'-]*$/.test(text)) {
    return text;
  }
  const first = text.charAt(0);
  const rest = text.slice(1);
  if (first === first.toUpperCase() && rest !== rest.toUpperCase()) {
    return first.toLowerCase() + rest;
  }
  return text;
}

describe('normalizeWordValue', () => {
  it('should convert to lowercase and trim', () => {
    expect(normalizeWordValue('  HelloWorld  ')).toBe('helloworld');
    expect(normalizeWordValue('TEST')).toBe('test');
    expect(normalizeWordValue('Test-With-Dashes')).toBe('test-with-dashes');
  });

  it('should handle empty and null values', () => {
    expect(normalizeWordValue('')).toBe('');
    expect(normalizeWordValue('   ')).toBe('');
    expect(normalizeWordValue(null)).toBe('');
    expect(normalizeWordValue(undefined)).toBe('');
  });

  it('should handle non-string values', () => {
    expect(normalizeWordValue(123)).toBe('123');
    expect(normalizeWordValue(true)).toBe('true');
    expect(normalizeWordValue({})).toBe('[object object]');
  });
});

describe('normalizeBookValue', () => {
  it('should return bookId when provided', () => {
    expect(normalizeBookValue('abc123')).toBe('abc123');
    expect(normalizeBookValue('  def456  ')).toBe('def456');
  });

  it('should return __sync_book__ when empty', () => {
    expect(normalizeBookValue('')).toBe('__sync_book__');
    expect(normalizeBookValue('   ')).toBe('__sync_book__');
    expect(normalizeBookValue(null)).toBe('__sync_book__');
    expect(normalizeBookValue(undefined)).toBe('__sync_book__');
  });
});

describe('getQueuedWordKey', () => {
  it('should generate unique key based on word and bookId', () => {
    expect(getQueuedWordKey({ word: 'test', bookId: 'book1' }))
      .toBe('test::book1');
    expect(getQueuedWordKey({ word: 'Test', bookId: 'BOOK1' }))
      .toBe('test::BOOK1');
  });

  it('should handle missing bookId', () => {
    expect(getQueuedWordKey({ word: 'test' }))
      .toBe('test::__sync_book__');
    expect(getQueuedWordKey({ word: 'test', bookId: '' }))
      .toBe('test::__sync_book__');
  });

  it('should handle empty word', () => {
    expect(getQueuedWordKey({ word: '', bookId: 'book1' }))
      .toBe('::book1');
    expect(getQueuedWordKey({ bookId: 'book1' }))
      .toBe('::book1');
  });
});

describe('lowercaseFirstLetter', () => {
  it('should lowercase first letter for normal words', () => {
    expect(lowercaseFirstLetter('Hello')).toBe('hello');
    expect(lowercaseFirstLetter('World')).toBe('world');
    expect(lowercaseFirstLetter('Test')).toBe('test');
  });

  it('should not lowercase first letter for all-uppercase words', () => {
    expect(lowercaseFirstLetter('API')).toBe('API');
    expect(lowercaseFirstLetter('NASA')).toBe('NASA');
    expect(lowercaseFirstLetter('URL')).toBe('URL');
  });

  it('should not lowercase first letter for lowercase words', () => {
    expect(lowercaseFirstLetter('hello')).toBe('hello');
    expect(lowercaseFirstLetter('test')).toBe('test');
  });

  it('should handle words with hyphens and apostrophes', () => {
    expect(lowercaseFirstLetter('Well-known')).toBe('well-known');
    expect(lowercaseFirstLetter("It's")).toBe("it's");
  });

  it('should not process non-letter words', () => {
    expect(lowercaseFirstLetter('123abc')).toBe('123abc');
    expect(lowercaseFirstLetter('hello123')).toBe('hello123');
    expect(lowercaseFirstLetter('')).toBe('');
    expect(lowercaseFirstLetter('   ')).toBe('   ');
    expect(lowercaseFirstLetter('@test')).toBe('@test');
  });
});