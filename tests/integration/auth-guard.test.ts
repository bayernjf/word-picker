import { vi, describe, it, expect, beforeEach } from "vitest";

// The service worker touches the raw chrome.* namespace at module scope
// (chrome.storage.onChanged); the polyfill mock only defines `browser`.
// It also registers a self.addEventListener('unhandledrejection') handler.
(globalThis as Record<string, unknown>).chrome = {
  storage: { onChanged: { addListener: vi.fn() } },
};
(globalThis as Record<string, unknown>).self = {
  addEventListener: vi.fn(),
};

import browser from "webextension-polyfill";
import { addWord, ensureDefaults, getBooks, getWords, _resetCachesForTesting } from "../../lib/storage.js";
import { MESSAGE_TYPES } from "../../lib/messaging.js";
import { resetStorageState } from "../setup.js";

// The shared polyfill mock has no runtime.getURL, which the worker uses to
// gate extension-page-only messages.
(browser.runtime as unknown as Record<string, unknown>).getURL = (path: string) => `chrome-extension://test/${path}`;

// Importing the worker registers its onMessage listener on the mocked runtime.
await import("../../service/service-worker.js");

const addListenerMock = browser.runtime.onMessage.addListener as unknown as {
  mock: { calls: Array<[listener: (msg: unknown, sender: unknown, sendResponse: (r: unknown) => void) => unknown]> };
};
const listener = addListenerMock.mock.calls[0]?.[0];
if (!listener) throw new Error("service worker did not register an onMessage listener");

function dispatch(message: Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    listener(message, { url: "chrome-extension://test/popup/popup.html" }, resolve);
  });
}

function seedExpiredAuth(): void {
  const storage = browser.storage.local as unknown as {
    set(items: Record<string, unknown>): Promise<void>;
  };
  return storage.set({
    authData: {
      accessToken: "expired-access",
      refreshToken: "expired-refresh",
      user: { email: "a@b.c", id: "u1" },
      expiresAt: Math.floor(Date.now() / 1000) - 3600, // expired one hour ago
    },
    currentUserEmail: "a@b.c",
  }) as never;
}

describe("P1 regression: auth guards must not break local data", () => {
  beforeEach(async () => {
    resetStorageState();
    _resetCachesForTesting();
  });

  it("P1-2: unauthenticated users can save words locally (was a hard throw)", async () => {
    await ensureDefaults();
    const res = await dispatch({
      type: MESSAGE_TYPES.SAVE_WORD,
      entry: {
        word: "unauthenticated",
        translation: "未登录保存",
        timeAdded: Date.now(),
        timeUpdated: Date.now(),
        contexts: [],
        bookId: "local_default_book",
      },
    });
    expect(res.success).toBe(true);
    expect((res as { saved?: boolean }).saved).toBe(true);

    const words = await getWords();
    expect(words.some((w) => w.word === "unauthenticated")).toBe(true);
  });

  it("P1-1: expired token clears auth state only, never local words or sync queue", async () => {
    await ensureDefaults();
    await addWord({
      word: "precious",
      translation: "不能丢",
      timeAdded: Date.now(),
      timeUpdated: Date.now(),
      contexts: [],
      bookId: "local_default_book",
    });
    await seedExpiredAuth();

    const res = await dispatch({ type: MESSAGE_TYPES.AUTH_STATUS });
    expect(res.isLoggedIn).toBe(false);

    // The bug wiped words/books/syncQueue here. Everything must survive.
    const words = await getWords();
    expect(words.some((w) => w.word === "precious")).toBe(true);
    expect((await getBooks()).length).toBeGreaterThan(0);

    // Auth state itself IS cleared (the intended half of the old behaviour).
    const stored = await browser.storage.local.get(["authData"]);
    expect(stored["authData"]).toBeNull();
  });
});
