import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

import * as libHelpers from '../../lib/content-helpers.js';

const sharedEntry = fileURLToPath(new URL('../../content/shared.ts', import.meta.url));
const contentScriptPath = fileURLToPath(new URL('../../content/content-script.ts', import.meta.url));

// 构建 content/shared.js 的真实产物（与 build-cross-browser.ts 相同的打包方式），
// 以保证 content script 运行时拿到的就是 lib 的那一份实现。
function buildSharedBundle(): string {
  const result = buildSync({
    entryPoints: [sharedEntry],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    write: false,
    logLevel: 'silent',
  });
  return result.outputFiles[0].text;
}

type SharedApi = Partial<typeof libHelpers> & {
  escapeHtml?: (value: unknown) => string;
  sendMessage?: (...args: unknown[]) => Promise<unknown>;
  createLogger?: (namespace: string) => unknown;
};

function loadSharedApi(): SharedApi {
  const sandboxWindow: Record<string, unknown> = {};
  // 用 new Function 注入 window，模拟 classic script 的加载方式；
  // 若打包结果残留 import/export 语句会在这里直接抛 SyntaxError。
  new Function('window', buildSharedBundle())(sandboxWindow);
  const api = sandboxWindow.__WordPickerShared as SharedApi | undefined;
  expect(api).toBeTruthy();
  return api as SharedApi;
}

describe('content/shared.js bundle', () => {
  it('is a classic-script bundle and exposes every lookup helper from lib', () => {
    const api = loadSharedApi() as Record<string, unknown>;
    const expected = [
      'escapeHtml',
      'sendMessage',
      'createLogger',
      'DEFAULT_LOOKUP_KEY',
      'normalizeLookupKeys',
      'detectWordLanguage',
      'buildWordPattern',
      'extractSentence',
      'computeWordSignature',
      'findWordMatchAtOffset',
      'isCjkChar',
      'isHangulChar',
      'LANG_LABELS',
      'LANG_SHORT_LABELS',
    ];
    for (const key of expected) {
      expect(api[key], `missing ${key}`).toBeDefined();
    }
  });

  it('produces the same results as lib/content-helpers.ts (drift lock)', () => {
    const api = loadSharedApi();
    const words = ['hello', 'Schön', 'niño', 'café', '漢字', '안녕', 'A', 'THE'];
    for (const word of words) {
      expect(api.detectWordLanguage?.(word), word).toBe(libHelpers.detectWordLanguage(word));
    }

    const pattern = api.buildWordPattern!(['en', 'fr', 'es', 'de']);
    const libPattern = libHelpers.buildWordPattern(['en', 'fr', 'es', 'de']);
    const text = 'the Schön niño café word';
    expect([...text.matchAll(pattern)].map((m: RegExpMatchArray) => m[0])).toEqual(
      [...text.matchAll(libPattern)].map((m) => m[0])
    );

    expect(api.findWordMatchAtOffset?.(text, 5, pattern)).toEqual(
      libHelpers.findWordMatchAtOffset(text, 5, libPattern)
    );
    expect(api.normalizeLookupKeys?.({ lookupKey: 'Meta' })).toEqual(
      libHelpers.normalizeLookupKeys({ lookupKey: 'Meta' })
    );
  });

  it('content-script keeps no local copies of the shared helpers', () => {
    const source = fs.readFileSync(contentScriptPath, 'utf8');
    const forbidden = [
      /function normalizeLookupKeys/,
      /function detectWordLanguage/,
      /function buildWordPattern/,
      /function computeWordSignature/,
      /const LANGUAGE_WORD_PATTERNS/,
      /const FRENCH_FEATURE_CHARS/,
      /matchAll\(wordPattern\)/,
    ];
    for (const pattern of forbidden) {
      expect(source, `content-script still defines ${pattern}`).not.toMatch(pattern);
    }
  });
});
