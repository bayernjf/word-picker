// Content scripts load browser-polyfill as a global script before this file,
// so `browser` is available on `window` without an import.
declare const browser: typeof import("webextension-polyfill").default;

interface WordPickerShared {
  escapeHtml: (value: unknown) => string;
  sendMessage: typeof import("../lib/utils.js").sendMessage;
  createLogger: typeof import("../lib/logger.js").createLogger;
}

declare global {
  interface Window {
    __WordPickerShared?: WordPickerShared;
  }
}
