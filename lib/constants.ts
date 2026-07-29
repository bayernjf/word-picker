// 注意：这些常量在构建时由 build-cross-browser.ts 的 replaceEnvVars 直接替换为字面量值。
// 本地构建从 .env.local 读取，生产构建使用 fallback 默认值。
// 不要用函数包裹，避免运行时在 Service Worker 中访问 import.meta 导致异常。

// 同步 API 地址（后端 API 在根路径 /api/v1/*）
export const DEFAULT_SYNC_BASE_URL = "http://localhost:3001";

// word-base 前端地址（logo 跳转/登录页面）
export const WORD_BASE_APP_URL = "http://localhost:3000/app";

export const SETTINGS_LIMITS = {
  HOVER_DELAY_MIN: 100,
  HOVER_DELAY_MAX: 1500,
  HOVER_DELAY_DEFAULT: 100,
  CACHE_SIZE_MIN: 50,
  CACHE_SIZE_MAX: 500,
  CACHE_SIZE_DEFAULT: 200,
};

export const DEFAULT_BOOK_NAME = "默认";

export const QUEUE_MAX_LENGTH = 500;

export type LookupKey = "Control" | "Meta" | "Alt" | "Shift";
export type Platform = "mac" | "win";

export interface LanguageConfig {
  code: string;
  label: string;
  ocrCode: string;
  myMemoryLang: string;
  enabled: boolean;
  note?: string;
}

export const SUPPORTED_LANGUAGES: LanguageConfig[] = [
  { code: "en", label: "英语", ocrCode: "eng", myMemoryLang: "en", enabled: true },
  { code: "fr", label: "法语", ocrCode: "fra", myMemoryLang: "fr", enabled: true },
  { code: "es", label: "西班牙语", ocrCode: "spa", myMemoryLang: "es", enabled: true },
  { code: "ja", label: "日语", ocrCode: "jpn", myMemoryLang: "ja", enabled: false, note: "即将支持" },
];

export const LANGUAGE_WORD_PATTERNS: Record<string, string> = {
  en: "[A-Za-z][A-Za-z'-]{1,44}",
  fr: "[A-Za-z\u00C0-\u00FF][A-Za-z\u00C0-\u00FF'-]{1,44}",
  es: "[A-Za-z\u00C0-\u00FF\u00D1\u00F1][A-Za-z\u00C0-\u00FF\u00D1\u00F1'-]{1,44}",
};

export const FRENCH_FEATURE_CHARS = /[\u00E0\u00E2\u00E7\u00E8\u00E9\u00EA\u00EB\u00EE\u00EF\u00F4\u00F9\u00FB\u00FC\u0153]/;
export const SPANISH_FEATURE_CHARS = /[\u00F1\u00A1\u00BF]/;

const MAC_RE = /Mac|iPod|iPhone|iPad/;

export function detectPlatform(): Platform {
  if (typeof navigator !== "undefined" && navigator.platform) {
    return MAC_RE.test(navigator.platform) ? "mac" : "win";
  }
  return "win";
}
