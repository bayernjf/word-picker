/**
 * 离线词库（IndexedDB）
 *
 * 数据源：assets/dict/ecdict.min.json（由 scripts/build-dict.js 从 ECDICT 生成）
 * 结构：
 *   { version, count, lemmaCount, entries:[{w,p,t}], lemma:{ 变形: 原词 } }
 *
 * 能力：
 *   - ensureDictImported()  首次安装把 JSON 灌入 IndexedDB（幂等，按版本跳过）
 *   - lookupOffline(word)   查询单词，未命中时用 lemma 词形还原后再查
 *
 * 仅在 service worker 中使用（IndexedDB 不可用于无 window 的纯函数模块）。
 */

import browser from "webextension-polyfill";
import { createLogger } from "./logger.js";

const logger = createLogger("offlineDict");

const DB_NAME = "wordpicker-dict";
const DB_VERSION = 1;
const STORE_ENTRIES = "entries"; // keyPath: key（小写单词）
const STORE_LEMMA = "lemma"; // keyPath: from（小写变形）
const STORE_META = "meta"; // keyPath: name

const DICT_ASSET_PATH = "assets/dict/ecdict.min.json";
const META_VERSION_KEY = "dictVersion";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_ENTRIES)) {
        db.createObjectStore(STORE_ENTRIES, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(STORE_LEMMA)) {
        db.createObjectStore(STORE_LEMMA, { keyPath: "from" });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: "name" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txComplete(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function getByKey(db: IDBDatabase, storeName: string, key: string): Promise<Record<string, unknown> | null> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const request = tx.objectStore(storeName).get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

let importPromise: Promise<void> | null = null;
let dbInstance: IDBDatabase | null = null;
let dbOpenPromise: Promise<IDBDatabase> | null = null;

const MEM_CACHE_MAX = 200;
const memCache = new Map<string, OfflineTranslationResult | null>();

function memCacheGet(key: string): OfflineTranslationResult | null | undefined {
  const value = memCache.get(key);
  if (value !== undefined) {
    memCache.delete(key);
    memCache.set(key, value);
  }
  return value;
}

function memCacheSet(key: string, value: OfflineTranslationResult | null): void {
  if (memCache.size >= MEM_CACHE_MAX) {
    const firstKey = memCache.keys().next().value;
    if (firstKey !== undefined) {
      memCache.delete(firstKey);
    }
  }
  memCache.set(key, value);
}

async function getDb(): Promise<IDBDatabase> {
  if (dbInstance) {
    return dbInstance;
  }
  if (dbOpenPromise) {
    return dbOpenPromise;
  }
  dbOpenPromise = openDb().then((db) => {
    dbInstance = db;
    dbOpenPromise = null;
    db.onclose = () => {
      dbInstance = null;
    };
    db.onerror = () => {
      dbInstance = null;
      dbOpenPromise = null;
    };
    return db;
  }).catch((err) => {
    dbInstance = null;
    dbOpenPromise = null;
    throw err;
  });
  return dbOpenPromise;
}

function closeDb(): void {
  if (dbInstance) {
    try {
      dbInstance.close();
    } catch {
      // ignore
    }
    dbInstance = null;
  }
  dbOpenPromise = null;
}

/**
 * 确保离线词库已导入 IndexedDB（幂等）。
 * 多次并发调用复用同一 Promise，避免重复导入。
 */
export function ensureDictImported(): Promise<void> {
  logger.debug('ensureDictImported');
  if (!importPromise) {
    importPromise = doImport().catch((error) => {
      importPromise = null;
      logger.warn("[offlineDict] 词库导入失败：", error);
    });
  }
  return importPromise;
}

interface DictData {
  version?: number;
  entries?: Array<{ w?: string; p?: string; t?: string }>;
  lemma?: Record<string, string>;
}

async function doImport(): Promise<void> {
  const db = await getDb();
  try {
    const assetUrl = browser.runtime.getURL(DICT_ASSET_PATH);
    const response = await fetch(assetUrl);
    if (!response.ok) {
      throw new Error(`无法加载词库资源：HTTP ${response.status}`);
    }
    const data: DictData = await response.json();
    const assetVersion = Number(data?.version) || 0;

    const meta = await getByKey(db, STORE_META, META_VERSION_KEY);
    if (meta && Number(meta.value) === assetVersion) {
      return;
    }

    const entries = Array.isArray(data.entries) ? data.entries : [];
    const lemma = data.lemma && typeof data.lemma === "object" ? data.lemma : {};

    const BATCH = 5000;
    for (let i = 0; i < entries.length; i += BATCH) {
      const slice = entries.slice(i, i + BATCH);
      const tx = db.transaction(STORE_ENTRIES, "readwrite");
      const store = tx.objectStore(STORE_ENTRIES);
      for (const e of slice) {
        const word = String(e.w || "").trim();
        if (!word) continue;
        store.put({
          key: word.toLowerCase(),
          word,
          phonetic: e.p || "",
          translation: e.t || "",
        });
      }
      await txComplete(tx);
    }

    const lemmaEntries = Object.entries(lemma);
    for (let i = 0; i < lemmaEntries.length; i += BATCH) {
      const slice = lemmaEntries.slice(i, i + BATCH);
      const tx = db.transaction(STORE_LEMMA, "readwrite");
      const store = tx.objectStore(STORE_LEMMA);
      for (const [from, to] of slice) {
        if (!from || !to) continue;
        store.put({ from: String(from).toLowerCase(), to: String(to).toLowerCase() });
      }
      await txComplete(tx);
    }

    const metaTx = db.transaction(STORE_META, "readwrite");
    metaTx.objectStore(STORE_META).put({ name: META_VERSION_KEY, value: assetVersion });
    await txComplete(metaTx);

    logger.info(`[offlineDict] 词库导入完成：${entries.length} 词条 / ${lemmaEntries.length} 词形`);
  } catch (err) {
    closeDb();
    throw err;
  }
}

export interface OfflineTranslationResult {
  word: string;
  meaning: string;
  phonetic: string;
  exampleEn: string;
  exampleZh: string;
  note: string;
  provider: "offline";
}

/**
 * 离线查询单词。
 * @returns 命中返回 translator 兼容结构，未命中返回 null。
 */
export async function lookupOffline(word: string): Promise<OfflineTranslationResult | null> {
  const normalized = String(word || "").trim().toLowerCase();
  if (!normalized) return null;
  logger.debug('lookupOffline', { word: normalized });

  const cached = memCacheGet(normalized);
  if (cached !== undefined) {
    logger.debug('lookupOffline memCache hit', { word: normalized });
    return cached;
  }

  let db: IDBDatabase;
  try {
    db = await getDb();
  } catch (error) {
    logger.warn("[offlineDict] 打开数据库失败：", error);
    closeDb();
    return null;
  }

  try {
    let entry = await getByKey(db, STORE_ENTRIES, normalized);

    if (!entry) {
      const lemmaEntry = await getByKey(db, STORE_LEMMA, normalized);
      if (lemmaEntry && typeof lemmaEntry.to === 'string') {
        entry = await getByKey(db, STORE_ENTRIES, lemmaEntry.to);
      }
    }

    let result: OfflineTranslationResult | null = null;
    if (entry && entry.translation) {
      logger.info('lookupOffline hit', { word: entry.word || word });
      result = {
        word: String(entry.word || word),
        meaning: String(entry.translation),
        phonetic: String(entry.phonetic || ""),
        exampleEn: "",
        exampleZh: "",
        note: "",
        provider: "offline",
      };
    } else {
      logger.debug('lookupOffline miss', { word: normalized });
    }

    memCacheSet(normalized, result);
    return result;
  } catch (error) {
    logger.warn("[offlineDict] 查询失败：", error);
    closeDb();
    return null;
  }
}
