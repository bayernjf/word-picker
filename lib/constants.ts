// 注意：这些常量在构建时由 build-cross-browser.ts 的 replaceEnvVars 直接替换为字面量值。
// 本地构建从 .env.local 读取，生产构建使用 fallback 默认值。
// 不要用函数包裹，避免运行时在 Service Worker 中访问 import.meta 导致异常。

// 同步 API 地址（后端 API 在根路径 /api/v1/*）
export const DEFAULT_SYNC_BASE_URL = "https://word-base.pages.dev";

// word-base 前端地址（logo 跳转/登录页面）
export const WORD_BASE_APP_URL = "https://word-base.pages.dev/app";

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

const MAC_RE = /Mac|iPod|iPhone|iPad/;

export function detectPlatform(): Platform {
  if (typeof navigator !== "undefined" && navigator.platform) {
    return MAC_RE.test(navigator.platform) ? "mac" : "win";
  }
  return "win";
}
