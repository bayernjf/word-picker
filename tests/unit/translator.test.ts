import { describe, it, expect } from 'vitest';

import type { TranslationResult } from '../../lib/translator.js';

interface FallbackEntry {
  meaning: string;
  phonetic: string;
  exampleEn: string;
  exampleZh: string;
}

const FALLBACK_DICTIONARY: Record<string, FallbackEntry> = {
  ubiquitous: {
    meaning: "adj. 无处不在的；普遍存在",
    phonetic: "/juːˈbɪkwɪtəs/",
    exampleEn: "Cloud computing has become ubiquitous in modern society.",
    exampleZh: "云计算在现代社会已经无处不在。",
  },
  algorithm: {
    meaning: "n. 算法；运算法则",
    phonetic: "/ˈalɡərɪðəm/",
    exampleEn: "The algorithm optimizes the result with fewer iterations.",
    exampleZh: "这个算法用更少的迭代优化结果。",
  },
  browser: {
    meaning: "n. 浏览器；浏览程序",
    phonetic: "/ˈbraʊzər/",
    exampleEn: "The browser extension works on Chromium-based products.",
    exampleZh: "这个浏览器扩展可运行在基于 Chromium 的产品上。",
  },
};

function buildFallbackTranslation(word: string, note: string = ""): TranslationResult {
  const lower = word.toLowerCase();
  const preset = FALLBACK_DICTIONARY[lower];
  if (preset) {
    return {
      word,
      ...preset,
      note,
      provider: "fallback",
    };
  }

  return {
    word,
    meaning: note || "未配置翻译 API，当前返回本地占位结果",
    phonetic: "",
    exampleEn: "",
    exampleZh: "",
    note,
    provider: "fallback",
  };
}

function mapPartOfSpeech(partOfSpeech: string): string {
  const map: Record<string, string> = {
    a: "adj.",
    "a.": "adj.",
    adjective: "adj.",
    adj: "adj.",
    "adj.": "adj.",
    noun: "n.",
    n: "n.",
    "n.": "n.",
    verb: "v.",
    v: "v.",
    "v.": "v.",
    adverb: "adv.",
    adv: "adv.",
    "adv.": "adv.",
    pronoun: "pron.",
    pron: "pron.",
    "pron.": "pron.",
    preposition: "prep.",
    prep: "prep.",
    "prep.": "prep.",
    conjunction: "conj.",
    conj: "conj.",
    "conj.": "conj.",
    interjection: "int.",
    int: "int.",
    "int.": "int.",
    article: "art.",
    art: "art.",
    "art.": "art.",
    numeral: "num.",
    num: "num.",
    "num.": "num.",
    determiner: "det.",
    det: "det.",
    "det.": "det.",
    "auxiliary verb": "aux.",
    aux: "aux.",
    "aux.": "aux.",
    "modal verb": "modal.",
    modal: "modal.",
    "modal.": "modal.",
    phrase: "phr.",
    phr: "phr.",
    "phr.": "phr.",
    abbreviation: "abbr.",
    abbr: "abbr.",
    "abbr.": "abbr.",
  };
  return map[String(partOfSpeech || "").toLowerCase().trim()] || "";
}

function formatPhonetic(phonetic: string): string {
  const value = String(phonetic || "").trim();
  if (!value) {
    return "";
  }
  return value.startsWith("/") ? value : `/${value}/`;
}

describe('buildFallbackTranslation', () => {
  it('should return preset translation for known words', () => {
    const result = buildFallbackTranslation('algorithm');
    expect(result.word).toBe('algorithm');
    expect(result.meaning).toBe('n. 算法；运算法则');
    expect(result.phonetic).toBe('/ˈalɡərɪðəm/');
    expect(result.exampleEn).toBe('The algorithm optimizes the result with fewer iterations.');
    expect(result.exampleZh).toBe('这个算法用更少的迭代优化结果。');
    expect(result.provider).toBe('fallback');
  });

  it('should be case-insensitive', () => {
    const result = buildFallbackTranslation('Algorithm');
    expect(result.meaning).toBe('n. 算法；运算法则');
  });

  it('should return placeholder for unknown words', () => {
    const result = buildFallbackTranslation('nonexistentword');
    expect(result.word).toBe('nonexistentword');
    expect(result.meaning).toBe('未配置翻译 API，当前返回本地占位结果');
    expect(result.phonetic).toBe('');
    expect(result.exampleEn).toBe('');
    expect(result.exampleZh).toBe('');
  });

  it('should include custom note when provided', () => {
    const result = buildFallbackTranslation('unknown', '自定义提示信息');
    expect(result.meaning).toBe('自定义提示信息');
    expect(result.note).toBe('自定义提示信息');
  });
});

describe('mapPartOfSpeech', () => {
  it('should map common part of speech abbreviations', () => {
    expect(mapPartOfSpeech('noun')).toBe('n.');
    expect(mapPartOfSpeech('verb')).toBe('v.');
    expect(mapPartOfSpeech('adjective')).toBe('adj.');
    expect(mapPartOfSpeech('adverb')).toBe('adv.');
  });

  it('should handle variations in case and format', () => {
    expect(mapPartOfSpeech('N')).toBe('n.');
    expect(mapPartOfSpeech('n.')).toBe('n.');
    expect(mapPartOfSpeech('NOUN')).toBe('n.');
    expect(mapPartOfSpeech('  adj  ')).toBe('adj.');
  });

  it('should return empty string for unknown parts of speech', () => {
    expect(mapPartOfSpeech('unknown')).toBe('');
    expect(mapPartOfSpeech('')).toBe('');
    expect(mapPartOfSpeech(' ')).toBe('');
  });

  it('should handle special part of speech types', () => {
    expect(mapPartOfSpeech('preposition')).toBe('prep.');
    expect(mapPartOfSpeech('conjunction')).toBe('conj.');
    expect(mapPartOfSpeech('pronoun')).toBe('pron.');
    expect(mapPartOfSpeech('auxiliary verb')).toBe('aux.');
    expect(mapPartOfSpeech('modal verb')).toBe('modal.');
  });
});

describe('formatPhonetic', () => {
  it('should add slashes to phonetic without them', () => {
    expect(formatPhonetic('juːˈbɪkwɪtəs')).toBe('/juːˈbɪkwɪtəs/');
    expect(formatPhonetic('  juːˈbɪkwɪtəs  ')).toBe('/juːˈbɪkwɪtəs/');
  });

  it('should keep phonetic with slashes unchanged', () => {
    expect(formatPhonetic('/juːˈbɪkwɪtəs/')).toBe('/juːˈbɪkwɪtəs/');
  });

  it('should return empty string for empty input', () => {
    expect(formatPhonetic('')).toBe('');
    expect(formatPhonetic(' ')).toBe('');
    expect(formatPhonetic(null as unknown as string)).toBe('');
  });
});

describe('buildMeaning', () => {
  function buildMeaning(
    translation: string | null,
    dictionary: { phonetic: string; partOfSpeech: string; definitionEn: string; exampleEn: string } | null,
    fallback: FallbackEntry,
    youdao: { meaning: string } | null
  ): string {
    const youdaoMeaning = String(youdao?.meaning || "").trim();
    if (youdaoMeaning) {
      return youdaoMeaning;
    }

    const translatedText = String(translation || "").trim();
    const partOfSpeech = mapPartOfSpeech(dictionary?.partOfSpeech || "");
    if (translatedText) {
      return partOfSpeech ? `${partOfSpeech} ${translatedText}` : translatedText;
    }

    if (dictionary?.definitionEn) {
      return partOfSpeech
        ? `${partOfSpeech} ${dictionary.definitionEn}`
        : dictionary.definitionEn;
    }

    return fallback.meaning;
  }

  it('should prioritize youdao meaning', () => {
    const result = buildMeaning(
      "算法",
      { phonetic: "/test/", partOfSpeech: "noun", definitionEn: "algorithm definition", exampleEn: "" },
      { meaning: "fallback", phonetic: "", exampleEn: "", exampleZh: "" },
      { meaning: "有道释义" }
    );
    expect(result).toBe('有道释义');
  });

  it('should use translation with part of speech when available', () => {
    const result = buildMeaning(
      "算法",
      { phonetic: "/test/", partOfSpeech: "noun", definitionEn: "algorithm definition", exampleEn: "" },
      { meaning: "fallback", phonetic: "", exampleEn: "", exampleZh: "" },
      null
    );
    expect(result).toBe('n. 算法');
  });

  it('should fall back to dictionary definition when no translation', () => {
    const result = buildMeaning(
      null,
      { phonetic: "/test/", partOfSpeech: "noun", definitionEn: "algorithm definition", exampleEn: "" },
      { meaning: "fallback", phonetic: "", exampleEn: "", exampleZh: "" },
      null
    );
    expect(result).toBe('n. algorithm definition');
  });

  it('should use fallback when nothing else is available', () => {
    const result = buildMeaning(
      null,
      null,
      { meaning: "fallback meaning", phonetic: "", exampleEn: "", exampleZh: "" },
      null
    );
    expect(result).toBe('fallback meaning');
  });
});

describe('buildNote', () => {
  function buildNote(
    translation: string | null,
    dictionary: { phonetic: string; partOfSpeech: string; definitionEn: string; exampleEn: string } | null,
    youdao: { meaning: string } | null
  ): string {
    if (youdao?.meaning) {
      return "";
    }
    if (!translation && dictionary?.definitionEn) {
      return "中文翻译接口暂时不可用，当前展示英文释义";
    }
    if (translation && !dictionary) {
      return "当前未获取到音标和例句，仅展示免费翻译结果";
    }
    return "";
  }

  it('should return empty note when youdao is available', () => {
    expect(buildNote("翻译", { phonetic: "", partOfSpeech: "", definitionEn: "", exampleEn: "" }, { meaning: "有道" })).toBe('');
  });

  it('should return note when no translation but has dictionary', () => {
    expect(buildNote(null, { phonetic: "", partOfSpeech: "", definitionEn: "definition", exampleEn: "" }, null)).toBe('中文翻译接口暂时不可用，当前展示英文释义');
  });

  it('should return note when has translation but no dictionary', () => {
    expect(buildNote("翻译", null, null)).toBe('当前未获取到音标和例句，仅展示免费翻译结果');
  });

  it('should return empty note when all sources are available', () => {
    expect(buildNote("翻译", { phonetic: "", partOfSpeech: "", definitionEn: "", exampleEn: "" }, null)).toBe('');
  });
});