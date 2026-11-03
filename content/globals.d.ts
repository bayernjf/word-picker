// Content scripts load browser-polyfill as a global script before this file,
// so `browser` is available on `window` without an import.
declare const browser: typeof import("webextension-polyfill").default;

interface WordPickerShared {
  escapeHtml: (value: unknown) => string;
  sendMessage: (message: object, timeoutMs?: number) => Promise<{ success?: boolean; error?: string; [key: string]: unknown }>;
  createLogger: (namespace: string) => {
    debug: (...args: unknown[]) => void;
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  // 查词纯函数来自 lib/content-helpers.ts，由构建期打包进 content/shared.js
  DEFAULT_LOOKUP_KEY: typeof import("../lib/content-helpers.js").DEFAULT_LOOKUP_KEY;
  normalizeLookupKeys: typeof import("../lib/content-helpers.js").normalizeLookupKeys;
  detectWordLanguage: typeof import("../lib/content-helpers.js").detectWordLanguage;
  buildWordPattern: typeof import("../lib/content-helpers.js").buildWordPattern;
  extractSentence: typeof import("../lib/content-helpers.js").extractSentence;
  computeWordSignature: typeof import("../lib/content-helpers.js").computeWordSignature;
  findWordMatchAtOffset: typeof import("../lib/content-helpers.js").findWordMatchAtOffset;
  isCjkChar: typeof import("../lib/content-helpers.js").isCjkChar;
  isHangulChar: typeof import("../lib/content-helpers.js").isHangulChar;
  LANG_LABELS: typeof import("../lib/content-helpers.js").LANG_LABELS;
  LANG_SHORT_LABELS: typeof import("../lib/content-helpers.js").LANG_SHORT_LABELS;
}

declare global {
  interface Window {
    __WordPickerShared?: WordPickerShared;
  }
}
