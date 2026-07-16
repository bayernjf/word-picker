import { getCacheMap, saveCacheMap } from "./storage.js";

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const EVICT_RATIO = 0.05;

export interface CachedTranslation {
  word: string;
  meaning: string;
  phonetic?: string;
  exampleEn?: string;
  exampleZh?: string;
  note?: string;
  provider: string;
  ts: number;
  lastAccessedAt: number;
}

export interface CacheMap {
  [key: string]: CachedTranslation;
}

let cacheMutationChain: Promise<unknown> = Promise.resolve();

async function runCacheMutation<T>(mutation: () => Promise<T>): Promise<T> {
  const result = cacheMutationChain.then(mutation);
  cacheMutationChain = result.then(() => undefined, () => undefined);
  return result as Promise<T>;
}

const LAST_ACCESS_WRITE_INTERVAL_MS = 60 * 1000;
let pendingAccessUpdates: Record<string, number> = {};
let pendingAccessFlushTimer: number | null = null;

function flushPendingAccessUpdates(): void {
  if (pendingAccessFlushTimer !== null) {
    clearTimeout(pendingAccessFlushTimer);
    pendingAccessFlushTimer = null;
  }
  const updates = pendingAccessUpdates;
  pendingAccessUpdates = {};
  const keys = Object.keys(updates);
  if (keys.length === 0) return;
  void runCacheMutation(async () => {
    const cache = await getCacheMap();
    for (const key of keys) {
      if (cache[key]) {
        const entry = cache[key] as CachedTranslation;
        if ((updates[key] || 0) > (entry.lastAccessedAt || 0)) {
          entry.lastAccessedAt = updates[key];
        }
      }
    }
    await saveCacheMap(cache);
  });
}

export function normalizeCacheKey(word: string): string {
  return String(word || "").trim().toLowerCase();
}

export async function getCachedTranslation(word: string): Promise<CachedTranslation | null> {
  return runCacheMutation(async () => getCachedTranslationInternal(word));
}

async function getCachedTranslationInternal(word: string): Promise<CachedTranslation | null> {
  const key = normalizeCacheKey(word);
  if (!key) {
    return null;
  }

  const cache = await getCacheMap();
  const entry = cache[key] as CachedTranslation | undefined;
  if (!entry) {
    return null;
  }

  const now = Date.now();
  const isExpired = now - (entry.ts || 0) > CACHE_TTL_MS;
  if (isExpired) {
    delete cache[key];
    await saveCacheMap(cache);
    return null;
  }

  pendingAccessUpdates[key] = now;
  if (pendingAccessFlushTimer === null) {
    pendingAccessFlushTimer = self.setTimeout(
      flushPendingAccessUpdates,
      LAST_ACCESS_WRITE_INTERVAL_MS
    );
  }

  return {
    ...entry,
    word: entry.word || word,
    lastAccessedAt: now,
  };
}

export async function setCachedTranslation(
  word: string,
  translation: Omit<CachedTranslation, 'ts' | 'lastAccessedAt'>,
  maxCacheSize: number = 200
): Promise<CachedTranslation> {
  return runCacheMutation(async () => setCachedTranslationInternal(word, translation, maxCacheSize));
}

async function setCachedTranslationInternal(
  word: string,
  translation: Omit<CachedTranslation, 'ts' | 'lastAccessedAt'>,
  maxCacheSize: number = 200
): Promise<CachedTranslation> {
  const key = normalizeCacheKey(word);
  const now = Date.now();
  if (!key) {
    return {
      ...translation,
      ts: now,
      lastAccessedAt: now,
    } as CachedTranslation;
  }

  const safeMaxSize = Math.max(1, Number(maxCacheSize) || 200);

  const cache = await getCacheMap();

  for (const entryKey of Object.keys(cache)) {
    const entry = cache[entryKey] as CachedTranslation | undefined;
    if (entry && now - (entry.ts || 0) > CACHE_TTL_MS) {
      delete cache[entryKey];
    }
  }

  const pendingKeys = Object.keys(pendingAccessUpdates);
  for (const entryKey of pendingKeys) {
    if (cache[entryKey]) {
      const entry = cache[entryKey] as CachedTranslation;
      const pendingTs = pendingAccessUpdates[entryKey] || 0;
      if (pendingTs > (entry.lastAccessedAt || 0)) {
        entry.lastAccessedAt = pendingTs;
      }
    }
  }
  pendingAccessUpdates = {};
  if (pendingAccessFlushTimer !== null) {
    clearTimeout(pendingAccessFlushTimer);
    pendingAccessFlushTimer = null;
  }

  cache[key] = {
    ...translation,
    word: translation.word || word,
    ts: now,
    lastAccessedAt: now,
  };

  const entries = Object.entries(cache) as Array<[string, CachedTranslation]>;
  const overflow = entries.length - safeMaxSize;
  if (overflow > 0) {
    const sorted = entries.sort((a, b) => {
      return (a[1].lastAccessedAt || a[1].ts || 0) - (b[1].lastAccessedAt || b[1].ts || 0);
    });
    const deleteCount = Math.max(overflow, Math.ceil(entries.length * EVICT_RATIO));
    sorted.slice(0, deleteCount).forEach(([entryKey]) => {
      delete cache[entryKey];
    });
  }

  await saveCacheMap(cache);
  return cache[key] as CachedTranslation;
}
