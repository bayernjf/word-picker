import { vi, describe, it, expect, beforeEach } from "vitest";
import { ensureDefaults, addWord, getWords, getBooks } from "../../lib/storage.js";
import { MESSAGE_TYPES } from "../../lib/messaging.js";
import { resetStorageState } from "../setup.js";

describe("Service Worker Integration", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    resetStorageState();
  });

  describe("Word Management", () => {
    it("should initialize with default data", async () => {
      const data = await ensureDefaults();
      expect(data.words).toEqual([]);
      expect(data.books).toHaveLength(1);
      expect(data.books[0].name).toBe("默认");
      expect(data.settings.syncEnabled).toBe(true);
    });

    it("should add a word with context", async () => {
      await ensureDefaults();
      const result = await addWord({
        word: "test",
        frequency: 1,
        translation: "测试",
        timeAdded: Date.now(),
        timeUpdated: Date.now(),
        contexts: [],
        bookId: "local_default_book",
      });
      expect(result.success).toBe(true);
      expect(result.entry.word).toBe("test");
    });

    it("should prevent duplicate words", async () => {
      await ensureDefaults();
      const now = Date.now();
      await addWord({
        word: "duplicate",
        frequency: 1,
        translation: "重复",
        timeAdded: now,
        timeUpdated: now,
        contexts: [],
        bookId: "local_default_book",
      });
      const result = await addWord({
        word: "duplicate",
        frequency: 1,
        translation: "重复",
        timeAdded: now + 1000,
        timeUpdated: now + 1000,
        contexts: [],
        bookId: "local_default_book",
      });
      expect(result.duplicate).toBe(true);
    });

    it("should get words by book", async () => {
      await ensureDefaults();
      const now = Date.now();
      await addWord({
        word: "book1-word",
        frequency: 1,
        translation: "单词1",
        timeAdded: now,
        timeUpdated: now,
        contexts: [],
        bookId: "local_default_book",
      });
      const words = await getWords();
      expect(words).toHaveLength(1);
      expect(words[0].word).toBe("book1-word");
    });
  });

  describe("Book Management", () => {
    it("should have default book", async () => {
      await ensureDefaults();
      const books = await getBooks();
      expect(books).toHaveLength(1);
      expect(books[0].id).toBe("local_default_book");
      expect(books[0].name).toBe("默认");
    });
  });

  describe("Message Types", () => {
    it("should have all required message types", () => {
      expect(MESSAGE_TYPES.SAVE_WORD).toBeDefined();
      expect(MESSAGE_TYPES.DELETE_WORD).toBeDefined();
      expect(MESSAGE_TYPES.GET_WORDS).toBeDefined();
      expect(MESSAGE_TYPES.TRANSLATE).toBeDefined();
      expect(MESSAGE_TYPES.AUTH_LOGIN).toBeDefined();
      expect(MESSAGE_TYPES.AUTH_REGISTER).toBeDefined();
      expect(MESSAGE_TYPES.AUTH_STATUS).toBeDefined();
    });
  });
});