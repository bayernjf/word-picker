import browser from 'webextension-polyfill';
import {
  addWord,
  deleteWordById,
  ensureDefaults,
  getBooks,
  getSettings,
  getWords,
  getWordsByBook,
  saveBooks,
  saveSettings,
  saveWords,
  searchWords,
  Word,
  WordContext,
  Settings,
} from '../lib/storage.js';
import { translateWord } from '../lib/translator.js';
import { ensureDictImported, lookupOffline } from '../lib/offlineDict.js';
import { getCachedTranslation, setCachedTranslation } from '../lib/cache.js';
import {
  selectPreferredSyncBook,
  normalizeContextValue,
  normalizeSourceLinkValue,
  fetchSyncJson,
  Book,
} from '../lib/utils.js';
import { QUEUE_MAX_LENGTH, DEFAULT_SYNC_BASE_URL } from '../lib/constants.js';
import { MESSAGE_TYPES, isKnownMessageType } from '../lib/messaging.js';
import { createLogger, setLogLevel } from '../lib/logger.js';
import {
  setSupabaseSession,
  getSupabaseSession,
  signInWithPassword,
  signUp,
  signOut,
  refreshSession as supabaseRefreshSession,
} from '../lib/supabase.js';
import type { TranslationResult } from '../lib/translator.js';
import type { OfflineTranslationResult } from '../lib/offlineDict.js';

const logger = createLogger('service-worker');

self.addEventListener('unhandledrejection', (event) => {
  logger.error('unhandled_rejection', { reason: event.reason instanceof Error ? event.reason.message : String(event.reason) });
});

self.addEventListener('error', (event) => {
  logger.error('global_error', { message: event.message, filename: event.filename, lineno: event.lineno, colno: event.colno });
});

const STORAGE_DEVICE_ID = 'deviceId';
const STORAGE_SYNC_QUEUE = 'syncQueue';
const STORAGE_DELETE_QUEUE = 'deleteQueue';
const STORAGE_AUTH = 'authData';
const STORAGE_SYNC_LOCK = 'syncLock';
const STORAGE_SYNC_FAILURE = 'syncFailure';

let isSyncing = false;

const SYNC_LOCK_TIMEOUT_MS = 120_000;
const SYNC_RETRY_BASE_MS = 3 * 60_000;
const SYNC_RETRY_MAX_MS = 60 * 60_000;

interface SyncFailureState {
  attempts: number;
  retryAfter: number;
  error: string;
}

async function getSyncFailure(): Promise<SyncFailureState | null> {
  const data = await browser.storage.local.get([STORAGE_SYNC_FAILURE]);
  const failure = data?.[STORAGE_SYNC_FAILURE] as Partial<SyncFailureState> | undefined;
  if (!failure || typeof failure.retryAfter !== 'number') {
    return null;
  }
  return {
    attempts: Math.max(1, Number(failure.attempts) || 1),
    retryAfter: failure.retryAfter,
    error: String(failure.error || 'sync_failed'),
  };
}

async function recordSyncFailure(error: string): Promise<SyncFailureState> {
  const previous = await getSyncFailure();
  const attempts = (previous?.attempts || 0) + 1;
  const delay = Math.min(SYNC_RETRY_BASE_MS * 2 ** (attempts - 1), SYNC_RETRY_MAX_MS);
  const failure = { attempts, retryAfter: Date.now() + delay, error };
  await browser.storage.local.set({ [STORAGE_SYNC_FAILURE]: failure });
  return failure;
}

async function clearSyncFailure(): Promise<void> {
  await browser.storage.local.remove([STORAGE_SYNC_FAILURE]);
}

async function syncLockAcquire(): Promise<boolean> {
  const data = await browser.storage.local.get([STORAGE_SYNC_LOCK]);
  const raw = data?.[STORAGE_SYNC_LOCK];
  if (raw) {
    const lockTime = typeof raw === 'number' ? raw : 0;
    if (Date.now() - lockTime < SYNC_LOCK_TIMEOUT_MS) {
      return false;
    }
    logger.warn('sync lock stale, force releasing', { lockTime });
  }
  await browser.storage.local.set({ [STORAGE_SYNC_LOCK]: Date.now() });
  isSyncing = true;
  return true;
}

async function syncLockRelease(): Promise<void> {
  isSyncing = false;
  try {
    await browser.storage.local.remove([STORAGE_SYNC_LOCK]);
  } catch (error) {
    logger.error('syncLockRelease failed', { error: error instanceof Error ? error.message : String(error) });
  }
}

async function initializeOnAwake(): Promise<void> {
  try {
    await ensureDefaults();
    const auth = await getAuthData();
    if (auth?.accessToken && auth?.refreshToken && !isAuthExpired(auth)) {
      setSupabaseSession({
        access_token: auth.accessToken,
        refresh_token: auth.refreshToken,
        user: auth.user?.id ? { id: auth.user.id, email: auth.user.email } : undefined,
        expires_at: typeof auth.expiresAt === 'number' ? auth.expiresAt : undefined,
      });
    }
    const settings = await getSettings();
    const syncQueue = await getSyncQueue();
    const deleteQueue = await getDeleteQueue();
    if ((syncQueue.length > 0 || deleteQueue.length > 0) && settings.syncEnabled !== false) {
      flushSyncQueue(settings).catch((err) => {
        logger.warn('[initializeOnAwake] 补偿同步失败，将由 alarm 重试', { error: err instanceof Error ? err.message : String(err) });
      });
    }
  } catch (err) {
    logger.error('[initializeOnAwake] failed', { error: err instanceof Error ? err.message : String(err) });
  }
}

browser.runtime.onInstalled.addListener(() => {
  ensureDefaults().catch((err) => logger.error('[onInstalled] ensureDefaults failed', { error: String(err) }));
  setupAlarms().catch((err) => logger.error('[onInstalled] setupAlarms failed', { error: String(err) }));
  ensureDictImported().catch((err) => logger.error('[onInstalled] ensureDictImported failed', { error: String(err) }));
  initializeOnAwake();
});

browser.runtime.onStartup.addListener(() => {
  ensureDefaults().catch((err) => logger.error('[onStartup] ensureDefaults failed', { error: String(err) }));
  setupAlarms().catch((err) => logger.error('[onStartup] setupAlarms failed', { error: String(err) }));
  ensureDictImported().catch((err) => logger.error('[onStartup] ensureDictImported failed', { error: String(err) }));
  initializeOnAwake();
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.settings) return;
  const newSettings = changes.settings.newValue as Partial<Settings> | undefined;
  if (newSettings?.logLevel) {
    setLogLevel(newSettings.logLevel);
  }
});

browser.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'sync-words') return;
  try {
    const settings = await getSettings();
    await flushSyncQueue(settings);
  } catch (err) {
    logger.error('[onAlarm] sync failed', { error: err instanceof Error ? err.message : String(err) });
  }
});

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const safeSendResponse = (data: unknown): void => {
    try {
      sendResponse(data as never);
    } catch {
      // port closed, ignore
    }
  };
  handleMessage(message as Message, sender)
    .then((payload) => safeSendResponse({ success: true, ...(payload as object) }))
    .catch((error) => {
      safeSendResponse({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    });

  return true;
});

interface Message {
  type: string;
  [key: string]: unknown;
}

async function handleMessage(message: Message, sender?: browser.Runtime.MessageSender): Promise<unknown> {
  await ensureDefaults();
  logger.debug('handleMessage', { type: message?.type });

  if (!message?.type || !isKnownMessageType(message.type)) {
    throw new Error(`unknown_message_type`);
  }

  const isExtensionPage = Boolean(sender?.url?.startsWith(browser.runtime.getURL('')));

  switch (message.type) {
    case MESSAGE_TYPES.SAVE_WORD:
      return handleSaveWord((message.entry || message.word) as Partial<Word> & { word: string; contexts?: WordContext[]; bookId?: string });
    case MESSAGE_TYPES.DELETE_WORD:
      return handleDeleteWord(String(message.id || message.wordId));
    case MESSAGE_TYPES.GET_WORDS:
      return { words: await searchWords(message.query as string || '') };
    case MESSAGE_TYPES.GET_BOOKS:
      return { books: await getBooks() };
    case MESSAGE_TYPES.GET_BOOK_WORDS:
      return { words: await getWordsByBook(message.bookId as string, message.query as string || '') };
    case MESSAGE_TYPES.EXPORT_WORDS:
      return handleExportWords(message.format as string, Array.isArray(message.words) ? message.words as Word[] : []);
    case MESSAGE_TYPES.GET_SETTINGS:
      return { settings: await getSettings() };
    case MESSAGE_TYPES.SAVE_SETTINGS:
      return { settings: await saveSettings(message.settings as Partial<Settings>) };
    case MESSAGE_TYPES.SYNC_NOW:
    case MESSAGE_TYPES.TRIGGER_SYNC:
      return { sync: await handleSyncNow() };
    case MESSAGE_TYPES.GET_SYNC_STATUS:
      return handleGetSyncStatus();
    case MESSAGE_TYPES.AUTH_LOGIN:
      return handleAuthLogin(message.email as string, message.password as string);
    case MESSAGE_TYPES.AUTH_REGISTER:
      return handleAuthRegister(message.email as string, message.password as string);
    case MESSAGE_TYPES.AUTH_LOGOUT:
      return handleAuthLogout();
    case MESSAGE_TYPES.AUTH_STATUS:
      return handleAuthStatus();
    case MESSAGE_TYPES.AUTH_SET_REMEMBER:
      return handleAuthSetRemember(message.remember as boolean);
    case MESSAGE_TYPES.AUTH_GET_CREDENTIALS:
      if (!isExtensionPage) {
        throw new Error('unauthorized_sender');
      }
      return handleAuthGetCredentials();
    case MESSAGE_TYPES.TRANSLATE:
      return handleTranslate(message.word as string);
    case MESSAGE_TYPES.PING:
      return { pong: true };
    default:
      throw new Error(`未知消息类型：${message?.type || 'EMPTY'}`);
  }
}

interface AuthData {
  accessToken: string;
  refreshToken: string;
  user?: { email?: string; id?: string };
  lastSyncAt?: number;
  expiresAt?: number | null;
}

interface SyncQueueEntry extends Word {
  id?: string;
  queueRevision?: string;
}

interface ServerBook {
  id: string;
  name?: string;
  description?: string;
  word_count?: number;
  icon?: string;
  is_sync?: boolean;
  created_at?: string;
  updated_at?: string;
}

interface ServerWord {
  id?: string;
  word?: string;
  frequency?: number;
  translation?: string;
  chinese_translation?: string;
  time_added?: string;
  time_updated?: string;
  created_at?: string;
  updated_at?: string;
  contexts?: WordContext[];
  book_id?: string;
  phonetic?: string;
  part_of_speech?: string;
  definition?: string;
  synonyms?: string[];
  examples?: Array<{ en: string; zh: string }>;
  usage_history?: unknown[];
  level?: string;
  familiarity?: number;
  sync_version?: number;
  meta?: {
    sourceUrl?: string;
    sourceTitle?: string;
    createdAt?: number;
  };
}

interface ServerWordPayload {
  word: string;
  frequency: number;
  translation: string;
  time_added: string;
  time_updated: string;
  contexts: Word['contexts'];
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
  meta: {
    sourceUrl: string;
    sourceTitle: string;
    createdAt: number;
  };
}

function isServerBook(value: unknown): value is ServerBook {
  return Boolean(value && typeof value === 'object' && typeof (value as ServerBook).id === 'string' && (value as ServerBook).id);
}

function isServerWord(value: unknown): value is ServerWord {
  const word = value as ServerWord;
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof word.id === 'string' &&
      word.id &&
      typeof word.word === 'string' &&
      word.word &&
      typeof word.book_id === 'string' &&
      word.book_id
  );
}

async function handleSaveWord(entry: Partial<Word> & { word: string; translation?: string; frequency?: number; timeAdded?: number; timeUpdated?: number; contexts?: WordContext[]; bookId?: string }): Promise<{
  saved: boolean;
  duplicate: boolean;
  entry: Word;
  sync: { ok: boolean; skipped?: boolean; queued?: boolean; queueSize: number };
}> {
  if (!entry?.word) {
    throw new Error('单词内容不能为空');
  }

  // 规范化：将单词首字母转为小写（仅当首字母为大写时）
  entry = { ...entry, word: lowercaseFirstLetter(entry.word) };
  logger.debug('handleSaveWord', { word: entry.word, bookId: entry.bookId });

  const auth = await getAuthData();
  const settings = await getSettings();

  // 检查是否启用了同步且已登录
  const syncEnabled = settings.syncEnabled !== false;
  const isLoggedIn = Boolean(auth?.accessToken && auth?.refreshToken);

  // 如果启用了同步但未登录，提示用户
  if (syncEnabled && !isLoggedIn) {
    throw new Error('请先登录才能添加单词');
  }

  // 仅当本地尚无任何单词本时，才同步拉取一次（首次冷启动需要拿到同步单词本 ID）。
  // 之后的保存不再被「保存前全量拉取」阻塞，避免每次添加都等一次网络往返。
  if (isLoggedIn) {
    const localBooks = await getBooks();
    if (!Array.isArray(localBooks) || localBooks.length === 0) {
      await syncForRead(settings);
    }
  }

  const existingWords = await getWords();
  const incomingContexts = Array.isArray(entry.contexts) ? entry.contexts : [];
  const duplicateEntry = existingWords.find((item) => {
    const sameWord = normalizeWordValue(item?.word) === normalizeWordValue(entry.word);
    if (!sameWord) return false;

    const existingContexts = Array.isArray(item.contexts) ? item.contexts : [];
    if (incomingContexts.length === 0) {
      return true;
    }

    return incomingContexts.every((incomingContext: WordContext) =>
      existingContexts.some((existingContext: WordContext) =>
        normalizeContextValue(existingContext?.context) === normalizeContextValue(incomingContext?.context) &&
        normalizeSourceLinkValue(existingContext) === normalizeSourceLinkValue(incomingContext)
      )
    );
  });
  const duplicate = Boolean(duplicateEntry);

  if (duplicate && duplicateEntry) {
    logger.info('handleSaveWord duplicate skipped', { word: entry.word });
    return {
      saved: true,
      duplicate: true,
      entry: duplicateEntry,
      sync: { ok: true, skipped: true, queueSize: 0 },
    };
  }

  const result = await addWord(entry as Omit<Word, 'bookId'> & { bookId?: string });

  if (result.duplicate) {
    logger.info('handleSaveWord duplicate skipped (after add)', { word: entry.word });
    return {
      saved: true,
      duplicate: true,
      entry: result.entry,
      sync: { ok: true, skipped: true, queueSize: 0 },
    };
  }

  // 只有在已登录时才尝试同步：本地已写入成功，远端推送放到后台异步进行，
  // 不阻塞「添加成功」提示。词条已入队并持久化，后台失败也会在后续同步重试。
  if (isLoggedIn) {
    await enqueueSyncEntry(result.entry || entry);
    // 不 await：后台 flush，失败不影响本地结果与用户提示
    flushSyncQueue(settings).catch((error) => {
      logger.warn('[handleSaveWord] 后台同步失败，已入队待重试：', error);
    });
    logger.info('handleSaveWord success (queued for sync)', { word: entry.word, queueSize: (await getSyncQueue()).length });
    return {
      saved: Boolean(result.success),
      duplicate,
      entry: result.entry,
      sync: { ok: true, queued: true, queueSize: (await getSyncQueue()).length },
    };
  }

  logger.info('handleSaveWord success (local only)', { word: entry.word });
  return {
    saved: Boolean(result.success),
    duplicate,
    entry: result.entry,
    sync: { ok: false, skipped: true, queueSize: 0 },
  };
}

async function handleDeleteWord(id: string): Promise<{
  deleted: boolean;
  sync?: FlushResult;
}> {
  if (!id) {
    throw new Error('缺少单词 id');
  }
  logger.debug('handleDeleteWord', { id });

  const result = await deleteWordById(id);
  if (result.success) {
    await enqueueDelete(id);
    flushSyncQueue(await getSettings(), true).catch((err) => {
      logger.warn('[handleDeleteWord] flushSyncQueue failed', { error: err instanceof Error ? err.message : String(err) });
    });
  }

  logger.info('handleDeleteWord success', { id, deleted: result.success });
  return {
    deleted: Boolean(result.success),
  };
}

async function handleExportWords(format: string, words: Word[]): Promise<{
  format: string;
  fileName: string;
  data: string;
}> {
  const normalized = String(format || 'json').toLowerCase();

  if (normalized === 'csv') {
    return {
      format: 'csv',
      fileName: 'wordpicker-words.csv',
      data: toCsv(words),
    };
  }

  return {
    format: 'json',
    fileName: 'wordpicker-words.json',
    data: JSON.stringify({ words }, null, 2),
  };
}

function toCsv(words: Word[]): string {
  const headers = ['word', 'frequency', 'translation', 'timeAdded', 'timeUpdated', 'contextCount'];
  const lines = [headers.join(',')];
  words.forEach((word) => {
    const contextCount = (word.contexts?.length || 0).toString();
    lines.push(
      headers
        .map((header) => {
          if (header === 'contextCount') {
            return csvEscape(contextCount);
          }
          const key = header as keyof Word;
          const value = word[key];
          const legacyValue = word._legacy?.[header as keyof NonNullable<Word['_legacy']>];
          return csvEscape((value ?? legacyValue ?? '') as string);
        })
        .join(',')
    );
  });
  return lines.join('\n');
}

function csvEscape(value: unknown): string {
  let text = String(value);
  if (/^[=+\-@]/.test(text)) {
    text = `'${text}`;
  }
  text = text.replace(/"/g, '""');
  return `"${text}"`;
}

async function handleSyncNow(): Promise<FlushResult> {
  return flushSyncQueue(await getSettings(), true);
}

interface SyncStatusResult {
  deviceId: string;
  syncQueueSize: number;
  deleteQueueSize: number;
  queueSize: number;
  isLoggedIn: boolean;
  user: AuthData['user'] | null;
  lastSyncAt: number | null;
}

async function handleGetSyncStatus(): Promise<SyncStatusResult> {
  const auth = await getAuthData();
  const deviceId = await ensureDeviceId();
  const syncQueue = await getSyncQueue();
  const deleteQueue = await getDeleteQueue();
  const loggedIn = Boolean(auth?.accessToken && auth?.refreshToken && auth && !isAuthExpired(auth));

  return {
    deviceId,
    syncQueueSize: syncQueue.length,
    deleteQueueSize: deleteQueue.length,
    queueSize: syncQueue.length + deleteQueue.length,
    isLoggedIn: loggedIn,
    user: loggedIn ? (auth?.user || null) : null,
    lastSyncAt: auth?.lastSyncAt || null,
  };
}

async function setupAlarms(): Promise<void> {
  const existing = await browser.alarms.get('sync-words');
  if (!existing) {
    await browser.alarms.create('sync-words', { periodInMinutes: 3 });
  }
}

async function ensureDeviceId(): Promise<string> {
  const current = await browser.storage.local.get([STORAGE_DEVICE_ID]);
  const existing = typeof current?.[STORAGE_DEVICE_ID] === 'string' ? current[STORAGE_DEVICE_ID].trim() : '';
  if (existing) {
    return existing;
  }
  const next = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `device-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await browser.storage.local.set({ [STORAGE_DEVICE_ID]: next });
  return next;
}

async function getQueue<T = unknown>(key: string): Promise<T[]> {
  const current = await browser.storage.local.get([key]);
  return Array.isArray(current?.[key]) ? (current[key] as T[]) : [];
}

async function setQueue<T = unknown>(key: string, queue: T[]): Promise<T[]> {
  await browser.storage.local.set({ [key]: queue });
  return queue;
}

async function getSyncQueue(): Promise<SyncQueueEntry[]> {
  const raw = await getQueue<Record<string, unknown>>(STORAGE_SYNC_QUEUE);
  const valid = raw.filter((item) =>
    item && typeof item === 'object' &&
    typeof item.word === 'string' && item.word.length > 0 &&
    typeof item.bookId === 'string'
  ) as unknown as SyncQueueEntry[];
  if (valid.length !== raw.length) {
    logger.warn('getSyncQueue filtered corrupted entries', { raw: raw.length, valid: valid.length });
    await setQueue(STORAGE_SYNC_QUEUE, valid);
  }
  return valid;
}

async function setSyncQueue(queue: SyncQueueEntry[]): Promise<SyncQueueEntry[]> {
  return setQueue(STORAGE_SYNC_QUEUE, queue);
}

async function getDeleteQueue(): Promise<string[]> {
  return getQueue(STORAGE_DELETE_QUEUE);
}

async function setDeleteQueue(queue: string[]): Promise<string[]> {
  return setQueue(STORAGE_DELETE_QUEUE, queue);
}

let queueMutationChain: Promise<void> = Promise.resolve();

async function runQueueMutation<T>(mutation: () => Promise<T>): Promise<T> {
  const result = queueMutationChain.then(mutation);
  queueMutationChain = result.then(() => undefined, () => undefined);
  return result;
}

async function enqueueSyncEntry(entry: SyncQueueEntry): Promise<void> {
  if (!entry?.word) {
    return;
  }

  await runQueueMutation(async () => {
    const queue = await getSyncQueue();
    const nextEntry = {
      ...entry,
      id: entry.id || entry._legacy?.id || `${entry.word}-${entry.timeAdded || Date.now()}`,
      queueRevision: globalThis.crypto?.randomUUID
        ? globalThis.crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    };
    const nextKey = getQueuedWordKey(nextEntry);
    const dedupedQueue = queue.filter((item) => getQueuedWordKey(item) !== nextKey);
    await setSyncQueue([nextEntry, ...dedupedQueue].slice(0, QUEUE_MAX_LENGTH));
  });
}

async function enqueueDelete(wordId: string): Promise<void> {
  await runQueueMutation(async () => {
    const syncQueue = await getSyncQueue();
    const deleteQueue = await getDeleteQueue();
    await setSyncQueue(syncQueue.filter((entry) => entry.id !== wordId && entry._legacy?.id !== wordId));
    if (!deleteQueue.includes(wordId)) {
      await setDeleteQueue([wordId, ...deleteQueue].slice(0, QUEUE_MAX_LENGTH));
    }
  });
}


function normalizeWordValue(word: unknown): string {
  return String(word || '').trim().toLowerCase();
}

// 规范化首字母大写的普通英文单词：仅 "Hello" 这类首字母大写、其余非全大写的单词转小写首字母；
// 全大写缩写（如 API、NASA）保持不变。
function lowercaseFirstLetter(word: string): string {
  const text = String(word || '');
  if (!text) {
    return text;
  }
  // 仅处理纯英文字母单词（允许连字符/撇号，如 well-known、it's）
  if (!/^[A-Za-z][A-Za-z'-]*$/.test(text)) {
    return text;
  }
  const first = text.charAt(0);
  // 首字母必须是大写，且其余部分不能含大写字母（排除 API、NASA、iOS 等）
  if (first >= 'A' && first <= 'Z' && text.slice(1) === text.slice(1).toLowerCase()) {
    return first.toLowerCase() + text.slice(1);
  }
  return text;
}

function normalizeBookValue(bookId: unknown): string {
  const trimmed = String(bookId || '').trim();
  return trimmed || '__sync_book__';
}

function getQueuedWordKey(entry: SyncQueueEntry): string {
  return `${normalizeWordValue(entry?.word)}::${normalizeBookValue(entry?.bookId)}`;
}

function getQueueRevision(entry: SyncQueueEntry): string {
  return entry.queueRevision || [
    getQueuedWordKey(entry),
    Number(entry.timeUpdated) || 0,
    JSON.stringify(entry.contexts || []),
  ].join('::');
}

async function syncForRead(settingsOverride?: Settings): Promise<void> {
  const auth = await getAuthData();
  if (!auth?.accessToken || !auth?.refreshToken) {
    return;
  }
  if (isSyncing) {
    return;
  }

  const settings = settingsOverride || (await getSettings());
  await flushSyncQueue(settings);
}

async function pullChanges(auth: AuthData): Promise<void> {
  const baseUrl = DEFAULT_SYNC_BASE_URL;
  const headers = { Authorization: `Bearer ${auth.accessToken}` };
  logger.debug('pullChanges started', { baseUrl });
  const [books, words] = await Promise.all([
    fetchSyncJson(`${baseUrl}/api/v1/books`, { headers }),
    fetchSyncJson(`${baseUrl}/api/v1/words`, { headers }),
  ]);

  if (!Array.isArray(books) || !books.every(isServerBook)) {
    throw new Error('sync_invalid_books_payload');
  }
  if (!Array.isArray(words) || !words.every(isServerWord)) {
    throw new Error('sync_invalid_words_payload');
  }

  const localBooks = books.map(mapServerBookToLocal);
  const localWords = words.map(mapServerWordToLocal);
  const pendingWords = await getSyncQueue();
  const pendingKeys = new Set(pendingWords.map(getQueuedWordKey));
  const mergedWords = [
    ...pendingWords,
    ...localWords.filter((word) => !pendingKeys.has(getQueuedWordKey(word))),
  ];
  await saveBooks(localBooks);
  await saveWords(mergedWords);
  logger.info('pullChanges success', { books: localBooks.length, words: mergedWords.length });
}

function mapServerBookToLocal(book: ServerBook): Book {
  return {
    id: book.id,
    name: book.name || '默认',
    description: book.description || '',
    wordCount: Number(book.word_count) || 0,
    icon: book.icon || 'BookOpen',
    isSync: Boolean(book.is_sync),
    createdAt: Date.parse(book.created_at || '') || Date.now(),
    updatedAt: Date.parse(book.updated_at || '') || Date.now(),
  };
}

function mapServerWordToLocal(word: ServerWord): Word {
  const timeAdded = Date.parse(word.time_added || word.created_at || '') || Date.now();
  const timeUpdated = Date.parse(word.time_updated || word.updated_at || '') || timeAdded;
  const examples = Array.isArray(word.examples) ? word.examples : [];
  return {
    id: word.id,
    word: word.word || '',
    frequency: Number(word.frequency) || Math.max((word.contexts || []).length || 0, 1),
    translation: word.translation || word.chinese_translation || '',
    timeAdded,
    timeUpdated,
    contexts: Array.isArray(word.contexts) ? word.contexts : [],
    bookId: word.book_id || '',
    _legacy: {
      id: word.id,
      phonetic: word.phonetic || '',
      exampleEn: examples[0]?.en || '',
      exampleZh: examples[0]?.zh || '',
      sourceUrl: word.meta?.sourceUrl || '',
      sourceTitle: word.meta?.sourceTitle || '',
      createdAt: timeAdded,
      reviewCount: 0,
    },
  };
}

function mapLocalWordToServer(word: Word): ServerWordPayload {
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
    meta: {
      sourceUrl: word._legacy?.sourceUrl || '',
      sourceTitle: word._legacy?.sourceTitle || '',
      createdAt: timeAdded,
    },
  };
}

async function pushDeletes(auth: AuthData): Promise<{ ok: boolean; processed: number }> {
  const deleteQueue = await getDeleteQueue();
  if (deleteQueue.length === 0) {
    return { ok: true, processed: 0 };
  }

  const baseUrl = DEFAULT_SYNC_BASE_URL;
  await fetchSyncJson(`${baseUrl}/api/v1/words/batch-delete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${auth.accessToken}`,
    },
    body: JSON.stringify({ wordIds: deleteQueue }),
  });

  const processedIds = new Set(deleteQueue);
  await runQueueMutation(async () => {
    const currentQueue = await getDeleteQueue();
    await setDeleteQueue(currentQueue.filter((wordId) => !processedIds.has(wordId)));
  });
  return { ok: true, processed: deleteQueue.length };
}

async function pushWords(auth: AuthData): Promise<{ ok: boolean; processed: number; error?: string; queueSize: number }> {
  const syncQueue = await getSyncQueue();
  if (syncQueue.length === 0) {
    return { ok: true, processed: 0, queueSize: 0 };
  }
  logger.debug('pushWords started', { queueSize: syncQueue.length });

  const baseUrl = DEFAULT_SYNC_BASE_URL;

  let syncBook: Book | null = null;
  const cachedBooks = await getBooks();
  syncBook = selectPreferredSyncBook(cachedBooks);

  if (!syncBook) {
    const serverBooks = await fetchSyncJson(`${baseUrl}/api/v1/books`, {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
    });
    if (!Array.isArray(serverBooks) || !serverBooks.every(isServerBook)) {
      throw new Error('sync_invalid_books_payload');
    }
    const mappedBooks = serverBooks.map(mapServerBookToLocal);
    syncBook = selectPreferredSyncBook(mappedBooks);
    await saveBooks(mappedBooks);
  }

  const serverWords = await fetchSyncJson(`${baseUrl}/api/v1/words`, {
    headers: { Authorization: `Bearer ${auth.accessToken}` },
  });
  if (!Array.isArray(serverWords) || !serverWords.every(isServerWord)) {
    throw new Error('sync_invalid_words_payload');
  }

  const serverWordsMap = new Map<string, ServerWord>();
  serverWords.forEach((serverWord) => {
    const key = `${normalizeWordValue(serverWord.word || '')}::${normalizeBookValue(serverWord.book_id || '')}`;
    serverWordsMap.set(key, serverWord);
  });

  const payloadByKey = new Map<string, { payload: ServerWordPayload; queueRevisions: Set<string> }>();
  syncQueue.forEach((item) => {
    const mapped = mapLocalWordToServer(item);
    const bookId = mapped.book_id;
    if ((!bookId || bookId === 'local_default_book' || bookId.length < 10) && syncBook) {
      mapped.book_id = syncBook.id;
    }
    if (typeof mapped.book_id !== 'string' || mapped.book_id.length <= 20) {
      return;
    }

    const key = `${normalizeWordValue(mapped.word)}::${normalizeBookValue(mapped.book_id)}`;
    const existingServerWord = serverWordsMap.get(key);
    if (existingServerWord) {
      mapped.phonetic = existingServerWord.phonetic || mapped.phonetic;
      mapped.part_of_speech = existingServerWord.part_of_speech || mapped.part_of_speech;
      mapped.definition = existingServerWord.definition || mapped.definition;
      mapped.chinese_translation = existingServerWord.chinese_translation || mapped.chinese_translation;
      mapped.synonyms = Array.isArray(existingServerWord.synonyms) ? existingServerWord.synonyms : mapped.synonyms;
      mapped.examples = Array.isArray(existingServerWord.examples) ? existingServerWord.examples : mapped.examples;
      mapped.usage_history = Array.isArray(existingServerWord.usage_history) ? existingServerWord.usage_history : mapped.usage_history;
      mapped.level = existingServerWord.level || mapped.level;
      mapped.familiarity = Number(existingServerWord.familiarity) || 0;
      (mapped as ServerWordPayload & { sync_version?: number }).sync_version = Number(existingServerWord.sync_version) || 0;
    }

    const existing = payloadByKey.get(key);
    if (existing) {
      existing.payload = mapped;
      existing.queueRevisions.add(getQueueRevision(item));
    } else {
      payloadByKey.set(key, { payload: mapped, queueRevisions: new Set([getQueueRevision(item)]) });
    }
  });
  const payload = [...payloadByKey.values()].map((entry) => entry.payload);

  if (payload.length === 0) {
    logger.warn('[pushWords] 无法同步单词：没有可用的 book_id，已缓存待下次同步');
    return { ok: false, processed: 0, error: 'no_book_id', queueSize: syncQueue.length };
  }

  logger.info(`[pushWords] 准备同步 ${payload.length} 个单词，book_id: ${payload[0]?.book_id}`);

  const syncResponse = await fetchSyncJson(`${baseUrl}/api/v1/words/batch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${auth.accessToken}`,
    },
    body: JSON.stringify({ words: payload }),
  });
  if (!syncResponse || typeof syncResponse !== 'object' || Array.isArray(syncResponse)) {
    throw new Error('sync_invalid_batch_payload');
  }
  const conflicts = Array.isArray((syncResponse as { conflicts?: unknown }).conflicts)
    ? (syncResponse as { conflicts: unknown[] }).conflicts.map(normalizeWordValue)
    : [];
  const conflictSet = new Set(conflicts);
  const syncedQueueRevisions = new Set(
    [...payloadByKey.entries()]
      .filter(([, entry]) => !conflictSet.has(normalizeWordValue(entry.payload.word)))
      .flatMap(([, entry]) => [...entry.queueRevisions])
  );
  if (syncedQueueRevisions.size > 0) {
    await runQueueMutation(async () => {
      const currentQueue = await getSyncQueue();
      await setSyncQueue(currentQueue.filter((item) => !syncedQueueRevisions.has(getQueueRevision(item))));
    });
    logger.info(`[pushWords] 同步完成，清除 ${syncedQueueRevisions.size} 条，队列剩余 ${(await getSyncQueue()).length} 条`);
  }
  if (conflictSet.size > 0) {
    throw new Error('sync_conflict');
  }

  return { ok: true, processed: payload.length, queueSize: (await getSyncQueue()).length };
}

async function ensureDefaultBookOnServer(accessToken: string): Promise<void> {
  const baseUrl = DEFAULT_SYNC_BASE_URL;
  const serverBooks = await fetchSyncJson(`${baseUrl}/api/v1/books`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!Array.isArray(serverBooks) || !serverBooks.every(isServerBook)) {
    throw new Error('sync_invalid_books_payload');
  }

  if (serverBooks.length === 0) {
    const newBook = await fetchSyncJson(`${baseUrl}/api/v1/books`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        name: '默认',
        description: '默认单词本',
        is_sync: true,
      }),
    });
    if (!newBook || typeof newBook !== 'object' || Array.isArray(newBook)) {
      throw new Error('sync_invalid_book_payload');
    }
    const mappedBook = mapServerBookToLocal(newBook as ServerBook);
    if (!mappedBook.id) {
      throw new Error('sync_invalid_book_payload');
    }
    await saveBooks([mappedBook]);
    logger.info('[ensureDefaultBookOnServer] 默认单词本创建成功:', mappedBook.id);
  } else {
    await saveBooks(serverBooks.map(mapServerBookToLocal));
  }
}

interface FlushResult {
  ok: boolean;
  skipped?: boolean;
  expired?: boolean;
  loggedOut?: boolean;
  processed?: number;
  queueSize: number;
  error?: string;
}

async function flushSyncQueue(settings: Settings, force: boolean = false): Promise<FlushResult> {
  const auth = await getAuthData();
  const syncQueue = await getSyncQueue();
  const deleteQueue = await getDeleteQueue();
  const queueSize = syncQueue.length + deleteQueue.length;

  if (!force) {
    const failure = await getSyncFailure();
    if (failure && failure.retryAfter > Date.now()) {
      logger.debug('flushSyncQueue skipped (backoff)', { retryAfter: failure.retryAfter });
      return { ok: false, skipped: true, queueSize, error: failure.error };
    }
  }

  if (!auth?.accessToken || !auth?.refreshToken) {
    logger.debug('flushSyncQueue skipped (not logged in)', { queueSize });
    return { ok: false, skipped: true, queueSize };
  }

  if (isAuthExpired(auth)) {
    await setAuthData(null);
    await setCurrentUserEmail(null);
    logger.warn('flushSyncQueue skipped (auth expired)', { queueSize });
    return { ok: false, skipped: true, expired: true, queueSize };
  }

  let activeAuth: AuthData = auth;
  if (isAuthExpiringSoon(auth)) {
    logger.debug('flushSyncQueue token expiring soon, refreshing in advance');
    const { session: refreshedSession, error: refreshError } = await supabaseRefreshSession(auth.refreshToken);
    if (refreshError || !refreshedSession) {
      logger.warn('flushSyncQueue pre-refresh failed, will try on-demand', { error: refreshError?.message });
    } else {
      activeAuth = {
        ...auth,
        accessToken: refreshedSession.access_token,
        refreshToken: refreshedSession.refresh_token,
        user: refreshedSession.user
          ? { email: refreshedSession.user.email || undefined, id: refreshedSession.user.id }
          : auth.user,
        expiresAt: refreshedSession.expires_at,
      };
      await setAuthData(activeAuth);
      setSupabaseSession({
        access_token: activeAuth.accessToken,
        refresh_token: activeAuth.refreshToken,
        user: activeAuth.user?.id ? { id: activeAuth.user.id, email: activeAuth.user.email } : undefined,
        expires_at: activeAuth.expiresAt ?? undefined,
      });
    }
  }

  if (isSyncing) {
    logger.debug('flushSyncQueue skipped (already syncing)');
    return { ok: true, skipped: true, queueSize };
  }

  // 尝试获取同步锁
  const acquired = await syncLockAcquire();
  if (!acquired) {
    logger.debug('flushSyncQueue skipped (lock held by another process)');
    return { ok: true, skipped: true, queueSize };
  }

  logger.debug('flushSyncQueue started', { syncQueue: syncQueue.length, deleteQueue: deleteQueue.length });

  try {
    setSupabaseSession({
      access_token: activeAuth.accessToken,
      refresh_token: activeAuth.refreshToken,
      user: activeAuth.user?.id ? { id: activeAuth.user.id, email: activeAuth.user.email } : undefined,
      expires_at: activeAuth.expiresAt ?? undefined,
    });

    const currentAuth: AuthData = {
      ...activeAuth,
    };
    let processed = 0;

    try {
      processed += (await pushDeletes(currentAuth)).processed;
      const wordsResult = await pushWords(currentAuth);
      if (!wordsResult.ok) {
        throw new Error(wordsResult.error || 'word_sync_failed');
      }
      processed += wordsResult.processed;
      await pullChanges(currentAuth);
    } catch (error) {
      if (String((error as Error)?.message || error) !== 'unauthorized') {
        throw error;
      }

      const { session: refreshedSession, error: refreshError } = await supabaseRefreshSession(activeAuth.refreshToken);
      if (refreshError || !refreshedSession) {
        await setAuthData(null);
        await setCurrentUserEmail(null);
        return { ok: false, error: refreshError?.message || 'token_refresh_failed', loggedOut: true, queueSize };
      }

      const refreshedAuth: AuthData = {
        accessToken: refreshedSession.access_token,
        refreshToken: refreshedSession.refresh_token,
        user: refreshedSession.user
          ? { email: refreshedSession.user.email || undefined, id: refreshedSession.user.id }
          : currentAuth.user,
        lastSyncAt: currentAuth.lastSyncAt,
        expiresAt: refreshedSession.expires_at,
      };
      await setAuthData({ ...refreshedAuth, lastSyncAt: currentAuth.lastSyncAt });

      processed = (await pushDeletes(refreshedAuth)).processed;
      const wordsResult = await pushWords(refreshedAuth);
      if (!wordsResult.ok) {
        throw new Error(wordsResult.error || 'word_sync_failed');
      }
      processed += wordsResult.processed;
      await pullChanges(refreshedAuth);
    }

    const finalSession = getSupabaseSession();
    if (finalSession) {
      await setAuthData({
        accessToken: finalSession.access_token,
        refreshToken: finalSession.refresh_token,
        user: finalSession.user ? { email: finalSession.user.email, id: finalSession.user.id } : undefined,
        lastSyncAt: Date.now(),
        expiresAt: finalSession.expires_at,
      });
    }
    await clearSyncFailure();
    logger.info('flushSyncQueue success', { queueSize: (await getSyncQueue()).length + (await getDeleteQueue()).length });

    return {
      ok: true,
      processed,
      queueSize: (await getSyncQueue()).length + (await getDeleteQueue()).length,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const failure = await recordSyncFailure(msg);
    const isTransientError =
      msg === 'Failed to fetch' ||
      msg.includes('NetworkError') ||
      msg.includes('network') ||
      msg.includes('timeout') ||
      msg.includes('AbortError') ||
      msg.startsWith('sync_http_') ||
      msg.startsWith('sync_invalid_');
    if (isTransientError) {
      logger.warn('flushSyncQueue deferred', { error: msg, retryAfter: failure.retryAfter });
    } else {
      logger.error('flushSyncQueue failed', { error: msg, retryAfter: failure.retryAfter });
    }
    return {
      ok: false,
      error: msg,
      queueSize: (await getSyncQueue()).length + (await getDeleteQueue()).length,
    };
  } finally {
    await syncLockRelease();
  }
}

function isAuthData(value: unknown): value is AuthData {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as Partial<AuthData>).accessToken === 'string' &&
      typeof (value as Partial<AuthData>).refreshToken === 'string'
  );
}

async function getAuthData(): Promise<AuthData | null> {
  const data = await browser.storage.local.get([STORAGE_AUTH]);
  const auth = data?.[STORAGE_AUTH];
  return isAuthData(auth) ? auth : null;
}

async function setAuthData(auth: AuthData | null): Promise<void> {
  await browser.storage.local.set({ [STORAGE_AUTH]: auth });
}

const STORAGE_REMEMBERED_CREDENTIALS = 'rememberedCredentials';

async function getRememberedCredentials(): Promise<{ email: string; password?: string } | null> {
  const data = await browser.storage.local.get([STORAGE_REMEMBERED_CREDENTIALS]);
  const creds = data[STORAGE_REMEMBERED_CREDENTIALS] as { email?: string } | null;
  if (!creds || typeof creds !== 'object') return null;
  return {
    email: String(creds.email || ''),
    password: undefined,
  };
}

async function saveRememberedCredentials(email: string, _password: string, remember: boolean): Promise<void> {
  if (remember) {
    await browser.storage.local.set({
      [STORAGE_REMEMBERED_CREDENTIALS]: {
        email: email || '',
        savedAt: Date.now(),
      },
    });
  } else {
    await browser.storage.local.remove([STORAGE_REMEMBERED_CREDENTIALS]);
  }
}

function isAuthExpired(auth: AuthData): boolean {
  return typeof auth.expiresAt === 'number' && Date.now() > auth.expiresAt;
}

const TOKEN_REFRESH_LEAD_MS = 5 * 60 * 1000;

function isAuthExpiringSoon(auth: AuthData): boolean {
  if (typeof auth.expiresAt !== 'number') return false;
  return Date.now() + TOKEN_REFRESH_LEAD_MS > auth.expiresAt;
}

// 勾选/取消“在此设备记住7天”时，管理登录凭证的保存
// expiresAt 使用 Supabase 返回的真实 JWT 过期时间，不在这里修改
async function handleAuthSetRemember(remember: boolean): Promise<{ ok: boolean }> {
  const auth = await getAuthData();
  if (!auth?.accessToken) {
    return { ok: true };
  }
  if (remember) {
    const credentials = await getRememberedCredentials();
    if (credentials?.email) {
      await saveRememberedCredentials(credentials.email, credentials.password || '', true);
    }
  } else {
    await browser.storage.local.remove([STORAGE_REMEMBERED_CREDENTIALS]);
  }
  return { ok: true };
}

async function handleAuthGetCredentials(): Promise<{ ok: boolean; email: string }> {
  try {
    const data = await browser.storage.local.get([STORAGE_REMEMBERED_CREDENTIALS]);
    const cred = data?.[STORAGE_REMEMBERED_CREDENTIALS] as { email?: string } | undefined;
    if (cred && typeof cred.email === 'string' && cred.email) {
      return { ok: true, email: cred.email };
    }
  } catch {
    // ignore
  }
  return { ok: true, email: '' };
}

// 存储当前登录用户的唯一标识（用于检测用户切换）
const STORAGE_CURRENT_USER_EMAIL = 'currentUserEmail';

async function getCurrentUserEmail(): Promise<string | null> {
  const data = await browser.storage.local.get([STORAGE_CURRENT_USER_EMAIL]);
  const email = data[STORAGE_CURRENT_USER_EMAIL];
  return typeof email === 'string' ? email : null;
}

async function setCurrentUserEmail(email: string | null): Promise<void> {
  await browser.storage.local.set({ [STORAGE_CURRENT_USER_EMAIL]: email });
}

// 清空用户数据（在切换用户或登出时调用）
async function clearUserData(): Promise<void> {
  await browser.storage.local.remove([
    'words',
    'books',
    'syncQueue',
    'deleteQueue',
    STORAGE_SYNC_QUEUE,
    STORAGE_DELETE_QUEUE,
    STORAGE_AUTH,
    STORAGE_REMEMBERED_CREDENTIALS,
    STORAGE_CURRENT_USER_EMAIL,
    STORAGE_DEVICE_ID,
  ]);
}

interface AuthResult {
  ok: boolean;
  error?: string;
  user?: { email: string; id: string } | null;
  accessToken?: string;
  needsEmailConfirmation?: boolean;
}

async function handleAuthLogin(email: string, password: string): Promise<AuthResult> {
  const { session, error } = await signInWithPassword(email, password);

  if (error || !session) {
    return { ok: false, error: error?.message || 'login_failed' };
  }

  const previousEmail = await getCurrentUserEmail();
  const newEmail = session.user?.email || email;

  if (previousEmail && previousEmail !== newEmail) {
    await clearUserData();
  }

  await setCurrentUserEmail(newEmail);
  const settings = await getSettings();
  await setAuthData({
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    user: { email: newEmail, id: session.user?.id || '' },
    lastSyncAt: Date.now(),
    expiresAt: session.expires_at || null,
  });
  await saveRememberedCredentials(email, password, Boolean(settings.rememberDevice7Days));
  await setupAlarms();
  flushSyncQueue(settings, true).catch((err) => {
    logger.warn('[handleAuthLogin] flushSyncQueue failed', { error: err instanceof Error ? err.message : String(err) });
  });

  return {
    ok: true,
    user: { email: newEmail, id: session.user?.id || '' },
    accessToken: session.access_token,
  };
}

async function handleAuthRegister(email: string, password: string): Promise<AuthResult> {
  const { session, user, error, needsEmailConfirmation } = await signUp(email, password);

  if (error) {
    return { ok: false, error: error.message };
  }

  if (needsEmailConfirmation || !session) {
    return { ok: true, needsEmailConfirmation: true, user: user ? { email, id: user.id || '' } : null };
  }

  const newEmail = session.user?.email || email;

  await setCurrentUserEmail(newEmail);
  const settings = await getSettings();
  await setAuthData({
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    user: { email: newEmail, id: session.user?.id || '' },
    lastSyncAt: Date.now(),
    expiresAt: session.expires_at || null,
  });
  await saveRememberedCredentials(email, password, Boolean(settings.rememberDevice7Days));
  await setupAlarms();

  try {
    await ensureDefaultBookOnServer(session.access_token);
  } catch (err) {
    logger.warn('[handleAuthRegister] 创建默认单词本失败:', (err as Error).message);
  }

  flushSyncQueue(settings, true).catch((err) => {
    logger.warn('[handleAuthRegister] flushSyncQueue failed', { error: err instanceof Error ? err.message : String(err) });
  });

  return {
    ok: true,
    user: { email: newEmail, id: session.user?.id || '' },
    accessToken: session.access_token,
  };
}

async function handleAuthLogout(): Promise<{ ok: boolean }> {
  const auth = await getAuthData();
  if (auth?.accessToken) {
    try {
      const result = await signOut(auth.accessToken);
      if (result.error) {
        logger.warn('[handleAuthLogout] Supabase 登出失败:', result.error.message);
      }
    } catch (error) {
      logger.warn('[handleAuthLogout] Supabase 登出失败:', error);
    }
  }
  try {
    await browser.alarms.clear('sync-words');
  } catch (err) {
    logger.warn('[handleAuthLogout] clear alarm failed', { error: err instanceof Error ? err.message : String(err) });
  }
  await setAuthData(null);
  await setCurrentUserEmail(null);
  await clearUserData();
  try {
    await browser.storage.local.remove(['deviceId']);
  } catch (err) {
    logger.warn('[handleAuthLogout] remove deviceId failed', { error: err instanceof Error ? err.message : String(err) });
  }
  return { ok: true };
}

interface AuthStatusResult {
  ok: boolean;
  isLoggedIn: boolean;
  user: AuthData['user'] | null;
}

async function handleAuthStatus(): Promise<AuthStatusResult> {
  const auth = await getAuthData();
  // 登录态已过期：清除并视为未登录
  if (auth && isAuthExpired(auth)) {
    await setAuthData(null);
    await setCurrentUserEmail(null);
    await clearUserData();
    return { ok: true, isLoggedIn: false, user: null };
  }
  return {
    ok: true,
    isLoggedIn: Boolean(auth?.accessToken && auth?.refreshToken),
    user: auth?.user || null,
  };
}

async function handleTranslate(word: string): Promise<{ translation: TranslationResult | OfflineTranslationResult; fromCache?: boolean; fromOffline?: boolean }> {
  if (!word || !word.trim()) {
    throw new Error('待翻译单词不能为空');
  }
  const settings = await getSettings();

  // 1. 先查缓存，命中直接返回（0 网络，秒回）
  const cached = await getCachedTranslation(word);
  if (cached) {
    return {
      translation: {
        word: cached.word,
        meaning: cached.meaning,
        phonetic: cached.phonetic || "",
        exampleEn: cached.exampleEn || "",
        exampleZh: cached.exampleZh || "",
        note: cached.note || "",
        provider: cached.provider,
      },
      fromCache: true,
    };
  }

  // 2. 查内置离线词库（IndexedDB，高频词秒回，无需联网）
  await ensureDictImported();
  const offline = await lookupOffline(word);
  if (offline) {
    await setCachedTranslation(word, offline, settings.maxCacheSize || 200);
    return { translation: offline, fromOffline: true };
  }

  // 3. 仍未命中才走网络翻译（生僻词/词组兜底）
  const translation = await translateWord(word, settings);

  // 4. 写回缓存（仅缓存有效结果，兜底结果不缓存以便后续重试）
  if (translation && translation.provider !== 'fallback') {
    await setCachedTranslation(word, translation, settings.maxCacheSize || 200);
  }

  return { translation };
}
