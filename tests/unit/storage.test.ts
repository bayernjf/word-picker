import { describe, it, expect } from 'vitest';
import { migrateSyncBaseUrlDefault } from '../../lib/storage.js';

function formatDateTimeForDisplay(timestamp: number): string {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

interface WordContext {
  context: string;
  timeAdded: number;
  sourceLink: string;
  translation: string;
}

interface MigratedWord {
  word: string;
  frequency: number;
  translation: string;
  timeAdded: number;
  timeUpdated: number;
  contexts: WordContext[];
  _legacy?: {
    id?: string;
    phonetic?: string;
    exampleEn?: string;
    exampleZh?: string;
    sourceUrl?: string;
    sourceTitle?: string;
    tags?: string[];
    reviewCount?: number;
    createdAt?: number;
    [key: string]: unknown;
  };
  bookId: string;
}

function migrateOldWordFormat(oldWord: Record<string, unknown>): MigratedWord {
  const now = Date.now();
  const timeAdded = typeof oldWord.createdAt === 'number' ? oldWord.createdAt : now;

  const contexts: WordContext[] = [];
  if (oldWord.sentence) {
    contexts.push({
      context: String(oldWord.sentence),
      timeAdded: timeAdded,
      sourceLink: typeof oldWord.sourceUrl === 'string' ? oldWord.sourceUrl : "",
      translation: ""
    });
  }

  return {
    word: typeof oldWord.word === 'string' ? oldWord.word : "",
    frequency: contexts.length || 1,
    translation: typeof oldWord.meaning === 'string' ? oldWord.meaning : "",
    timeAdded: timeAdded,
    timeUpdated: timeAdded,
    contexts: contexts,
    _legacy: {
      id: typeof oldWord.id === 'string' ? oldWord.id : undefined,
      phonetic: typeof oldWord.phonetic === 'string' ? oldWord.phonetic : undefined,
      exampleEn: typeof oldWord.exampleEn === 'string' ? oldWord.exampleEn : undefined,
      exampleZh: typeof oldWord.exampleZh === 'string' ? oldWord.exampleZh : undefined,
      sourceUrl: typeof oldWord.sourceUrl === 'string' ? oldWord.sourceUrl : undefined,
      sourceTitle: typeof oldWord.sourceTitle === 'string' ? oldWord.sourceTitle : undefined,
      tags: Array.isArray(oldWord.tags) ? oldWord.tags as string[] : undefined,
      reviewCount: typeof oldWord.reviewCount === 'number' ? oldWord.reviewCount : undefined,
      createdAt: typeof oldWord.createdAt === 'number' ? oldWord.createdAt : undefined,
    },
    bookId: "",
  };
}

describe('migrateSyncBaseUrlDefault', () => {
  it('moves a markerless known default to the current build default', () => {
    expect(migrateSyncBaseUrlDefault('https://word-base.pages.dev', undefined)).toEqual({
      syncBaseUrl: 'http://localhost:3001',
      buildDefaultMarker: 'http://localhost:3001',
    });
  });

  it('moves an unchanged previous build default to the current build default', () => {
    expect(migrateSyncBaseUrlDefault(
      'https://dev.word-base.pages.dev',
      'https://dev.word-base.pages.dev'
    )).toEqual({
      syncBaseUrl: 'http://localhost:3001',
      buildDefaultMarker: 'http://localhost:3001',
    });
  });

  it('preserves a custom HTTPS URL without a build marker', () => {
    expect(migrateSyncBaseUrlDefault('https://sync.example.com/', undefined)).toEqual({
      syncBaseUrl: 'https://sync.example.com',
      buildDefaultMarker: null,
    });
  });

  it('falls back from an insecure remote URL to the current build default', () => {
    expect(migrateSyncBaseUrlDefault('http://sync.example.com', undefined)).toEqual({
      syncBaseUrl: 'http://localhost:3001',
      buildDefaultMarker: 'http://localhost:3001',
    });
  });
});

describe('formatDateTimeForDisplay', () => {
  it('should format valid timestamp', () => {
    const timestamp = new Date('2026-07-13T10:30:45').getTime();
    expect(formatDateTimeForDisplay(timestamp)).toBe('2026-07-13 10:30:45');
  });

  it('should return empty string for invalid timestamp', () => {
    expect(formatDateTimeForDisplay(0)).toBe('');
    expect(formatDateTimeForDisplay(NaN)).toBe('');
    expect(formatDateTimeForDisplay(undefined as unknown as number)).toBe('');
    expect(formatDateTimeForDisplay(null as unknown as number)).toBe('');
  });

  it('should handle zero-padded values', () => {
    const timestamp = new Date('2026-01-02T03:04:05').getTime();
    expect(formatDateTimeForDisplay(timestamp)).toBe('2026-01-02 03:04:05');
  });
});

describe('migrateOldWordFormat', () => {
  it('should migrate old format with sentence', () => {
    const oldWord = {
      word: 'test',
      meaning: '测试',
      sentence: 'This is a test sentence.',
      sourceUrl: 'https://example.com',
      createdAt: 1234567890000,
      id: 'old-id-001',
      phonetic: '/test/',
    };

    const result = migrateOldWordFormat(oldWord);

    expect(result.word).toBe('test');
    expect(result.translation).toBe('测试');
    expect(result.timeAdded).toBe(1234567890000);
    expect(result.timeUpdated).toBe(1234567890000);
    expect(result.frequency).toBe(1);
    expect(result.contexts.length).toBe(1);
    expect(result.contexts[0].context).toBe('This is a test sentence.');
    expect(result.contexts[0].sourceLink).toBe('https://example.com');
    expect(result.contexts[0].translation).toBe('');
    expect(result._legacy?.id).toBe('old-id-001');
    expect(result._legacy?.phonetic).toBe('/test/');
    expect(result.bookId).toBe('');
  });

  it('should handle old format without sentence', () => {
    const oldWord = {
      word: 'test',
      meaning: '测试',
      createdAt: 1234567890000,
    };

    const result = migrateOldWordFormat(oldWord);

    expect(result.frequency).toBe(1);
    expect(result.contexts.length).toBe(0);
  });

  it('should use current time when createdAt is missing', () => {
    const oldWord = { word: 'test' };
    const result = migrateOldWordFormat(oldWord);
    
    expect(typeof result.timeAdded).toBe('number');
    expect(result.timeAdded).toBeGreaterThan(0);
    expect(result.timeUpdated).toBe(result.timeAdded);
  });

  it('should handle empty word', () => {
    const oldWord = { createdAt: 1234567890000 };
    const result = migrateOldWordFormat(oldWord);
    
    expect(result.word).toBe('');
    expect(result.translation).toBe('');
  });

  it('should preserve all legacy fields', () => {
    const oldWord = {
      word: 'test',
      meaning: '测试',
      createdAt: 1234567890000,
      id: 'id-001',
      phonetic: '/test/',
      exampleEn: 'Example sentence.',
      exampleZh: '例句翻译。',
      sourceUrl: 'https://example.com',
      sourceTitle: 'Example Title',
      tags: ['tag1', 'tag2'],
      reviewCount: 5,
    };

    const result = migrateOldWordFormat(oldWord);

    expect(result._legacy?.id).toBe('id-001');
    expect(result._legacy?.phonetic).toBe('/test/');
    expect(result._legacy?.exampleEn).toBe('Example sentence.');
    expect(result._legacy?.exampleZh).toBe('例句翻译。');
    expect(result._legacy?.sourceUrl).toBe('https://example.com');
    expect(result._legacy?.sourceTitle).toBe('Example Title');
    expect(result._legacy?.tags).toEqual(['tag1', 'tag2']);
    expect(result._legacy?.reviewCount).toBe(5);
    expect(result._legacy?.createdAt).toBe(1234567890000);
  });
});