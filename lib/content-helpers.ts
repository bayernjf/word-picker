// 查词交互层的纯函数集合（无 DOM 依赖），供 content-script 复用与单元测试。
// 单一事实来源，避免 content-script 重复定义常量与逻辑（此前副本已与 lib 漂移，
// 例如缺失德语 LANGUAGE_WORD_PATTERNS）。

import {
  LANGUAGE_WORD_PATTERNS,
  FRENCH_FEATURE_CHARS,
  SPANISH_FEATURE_CHARS,
  GERMAN_FEATURE_CHARS,
  SUPPORTED_LANGUAGES,
  type LookupKey,
} from "./constants.js";
import type { PerPlatformLookupKeys } from "./storage.js";

export const DEFAULT_LOOKUP_KEY: LookupKey = "Control";

// 将历史 `lookupKey`（单值）或 `lookupKeys`（分平台）统一为分平台结构。
// 不修改入参，返回规范化结果，兼容 chrome.storage 读取到的任意形状。
export function normalizeLookupKeys(
  raw: Record<string, unknown> | null | undefined
): PerPlatformLookupKeys {
  if (!raw || typeof raw !== "object") {
    return { mac: DEFAULT_LOOKUP_KEY, win: DEFAULT_LOOKUP_KEY };
  }
  const existing = raw.lookupKeys as Partial<PerPlatformLookupKeys> | undefined;
  if (existing && typeof existing === "object") {
    return {
      mac: (existing.mac as LookupKey) || DEFAULT_LOOKUP_KEY,
      win: (existing.win as LookupKey) || DEFAULT_LOOKUP_KEY,
    };
  }
  if (typeof raw.lookupKey === "string") {
    const legacy = raw.lookupKey as LookupKey;
    return { mac: legacy, win: legacy };
  }
  return { mac: DEFAULT_LOOKUP_KEY, win: DEFAULT_LOOKUP_KEY };
}

const CJK_REGEX = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3400-\u4DBF]/;
const HANGUL_REGEX = /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/;

export function isCjkChar(ch: string): boolean {
  return CJK_REGEX.test(ch);
}

export function isHangulChar(ch: string): boolean {
  return HANGUL_REGEX.test(ch);
}

export function detectWordLanguage(word: string): string {
  if (CJK_REGEX.test(word)) return "ja";
  if (HANGUL_REGEX.test(word)) return "ko";
  if (GERMAN_FEATURE_CHARS.test(word)) return "de";
  if (SPANISH_FEATURE_CHARS.test(word)) return "es";
  if (FRENCH_FEATURE_CHARS.test(word)) return "fr";
  return "en";
}

export function buildWordPattern(languages: string[]): RegExp {
  // Put "en" last in the alternation: the accented-language patterns (fr/es/de)
  // are supersets of the ASCII-only "en" pattern, so leading with them matches a
  // whole word including diacritics instead of fragmenting it (en matches the ASCII
  // prefix, the accented pattern the suffix). Without this, "niño"/"Schön" get split.
  const ordered = [
    ...languages.filter((l) => l !== "en"),
    ...(languages.includes("en") ? ["en"] : []),
  ];
  const patterns = ordered
    .map((lang) => LANGUAGE_WORD_PATTERNS[lang])
    .filter(Boolean);
  const combined = patterns.length > 0 ? patterns.join("|") : LANGUAGE_WORD_PATTERNS.en;
  return new RegExp(combined, "g");
}

// 从文本中截取目标词前后的上下文片段。word 为空时退化为头部切片。
export function extractSentence(text: string, word?: string): string {
  const idx = text.indexOf(word || "");
  if (idx < 0) return text.slice(0, 120);
  const start = Math.max(0, idx - 40);
  const end = Math.min(text.length, idx + 80);
  return text.slice(start, end);
}

// 取词窗口：只扫描 caret 附近的片段，避免对长文本节点每帧全量 matchAll。
// 单词模式最长 45 个字符（见 constants.ts），200 字符的窗口足以完整覆盖
// 光标所在的单词，不会把词切断。
export const LOOKUP_WINDOW_SIZE = 200;

export interface WordMatch {
  word: string;
  start: number;
  end: number;
}

// 返回覆盖 offset 的单词匹配（offset 落在 [start, end] 闭区间，与 hover 语义一致）。
// 结果与全量 text.matchAll 等价，但只扫描 offset 前后 windowSize 个字符。
export function findWordMatchAtOffset(
  text: string,
  offset: number,
  pattern: RegExp,
  windowSize: number = LOOKUP_WINDOW_SIZE
): WordMatch | null {
  const windowStart = Math.max(0, offset - windowSize);
  const windowEnd = Math.min(text.length, offset + windowSize);
  const matches = [...text.slice(windowStart, windowEnd).matchAll(pattern)];

  for (const match of matches) {
    const start = windowStart + (match.index ?? 0);
    const end = start + match[0].length;
    if (offset >= start && offset <= end) {
      const word = match[0];
      // 单个大写字母缩写/连字符碎片（≤3 字符）不作为查词目标。
      if (/^[A-Z'-]+$/.test(word) && word.length <= 3) {
        return null;
      }
      return { word, start, end };
    }
  }

  return null;
}

// 稳定签名：用于判断同一单词的查词结果是否需要刷新弹窗。
// 统一对 word 做小写归一，使 hover 路径与 OCR 路径签名语义一致。
export function computeWordSignature(word: string, start: number, end: number, text: string): string {
  return `${word.toLowerCase()}|${start}|${end}|${text}`;
}

export const LANG_LABELS: Record<string, string> = Object.fromEntries(
  SUPPORTED_LANGUAGES.map((l) => [l.code, l.label])
);

export const LANG_SHORT_LABELS: Record<string, string> = {
  en: "[英]",
  fr: "[法]",
  es: "[西]",
  de: "[德]",
  ko: "[한]",
  ja: "[日]",
};
