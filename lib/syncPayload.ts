// 纯函数：把本地 Word 映射为 WordBase 后端 /api/v1/words/batch 接收的载荷。
// 故意不依赖任何浏览器 API（webextension-polyfill 等），以便 word-base 的跨仓库
// 契约测试能在 node 环境直接导入并使用真实的映射逻辑。

export interface SyncWordContext {
  context: string;
  timeAdded: number;
  sourceLink: string;
  sourceRange?: unknown;
  translation: string;
}

export interface SyncWordInput {
  word: string;
  frequency?: number;
  translation?: string;
  timeAdded?: number;
  timeUpdated?: number;
  contexts?: SyncWordContext[];
  bookId?: string;
  // 单词源语言（ISO 639-1）。未提供时后端按默认 'en' 处理。
  sourceLang?: string;
  _legacy?: {
    phonetic?: string;
    exampleEn?: string;
    exampleZh?: string;
    sourceUrl?: string;
    sourceTitle?: string;
    createdAt?: number;
  };
}

export interface ServerWordPayload {
  word: string;
  frequency: number;
  translation: string;
  time_added: string;
  time_updated: string;
  contexts: SyncWordContext[];
  phonetic: string;
  part_of_speech: string;
  definition: string;
  chinese_translation: string;
  synonyms: string[];
  examples: Array<{ en: string; zh: string }>;
  usage_history: unknown[];
  level: string;
  familiarity: number;
  book_id?: string;
  // 多语言拾取：单词源语言，供后端按语言筛选与生成语言感知的 AI 释义
  source_language?: string;
  meta: {
    sourceUrl: string;
    sourceTitle: string;
    createdAt: number;
  };
}

export function mapLocalWordToServer(word: SyncWordInput): ServerWordPayload {
  const timeAdded = word.timeAdded || word._legacy?.createdAt || Date.now();
  const timeUpdated = word.timeUpdated || timeAdded;
  return {
    word: word.word,
    frequency: word.frequency || Math.max((word.contexts || []).length || 0, 1),
    translation: word.translation || '',
    time_added: new Date(timeAdded).toISOString(),
    time_updated: new Date(timeUpdated).toISOString(),
    contexts: Array.isArray(word.contexts) ? word.contexts : [],
    phonetic: word._legacy?.phonetic || '',
    part_of_speech: '',
    definition: '',
    chinese_translation: word.translation || '',
    synonyms: [],
    examples:
      word._legacy?.exampleEn || word._legacy?.exampleZh
        ? [
            {
              en: word._legacy?.exampleEn || '',
              zh: word._legacy?.exampleZh || '',
            },
          ]
        : [],
    usage_history: [],
    level: 'B2',
    familiarity: 0,
    book_id: word.bookId,
    source_language: word.sourceLang || 'en',
    meta: {
      sourceUrl: word._legacy?.sourceUrl || '',
      sourceTitle: word._legacy?.sourceTitle || '',
      createdAt: timeAdded,
    },
  };
}
