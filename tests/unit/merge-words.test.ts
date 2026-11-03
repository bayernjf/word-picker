import { describe, expect, it } from "vitest";
import { mergeWordsLastWriteWins } from "../../lib/merge-words";

const keyOf = (w: { word?: string; bookId?: string }) =>
  `${(w.word || "").toLowerCase()}::${w.bookId || ""}`;

describe("mergeWordsLastWriteWins", () => {
  it("keeps server rows when nothing local exists", () => {
    const merged = mergeWordsLastWriteWins(
      [{ word: "apple", bookId: "b1", timeUpdated: 100 }],
      [],
      keyOf,
      (w) => ({ ...w }),
    );
    expect(merged).toHaveLength(1);
  });

  it("keeps local-only words instead of dropping them", () => {
    const merged = mergeWordsLastWriteWins(
      [{ word: "apple", bookId: "b1", timeUpdated: 100 }],
      [{ word: "offline-new", bookId: "b1", timeUpdated: 50 }],
      keyOf,
      (w) => ({ ...w }),
    );
    expect(merged.map((w) => w.word).sort()).toEqual(["apple", "offline-new"]);
  });

  it("newer local edit wins over the server snapshot", () => {
    const merged = mergeWordsLastWriteWins(
      [{ word: "apple", bookId: "b1", timeUpdated: 100, translation: "server" } as never],
      [{ word: "apple", bookId: "b1", timeUpdated: 200, translation: "local" } as never],
      keyOf,
      (w) => ({ ...w } as never),
    );
    expect(merged).toHaveLength(1);
    expect((merged[0] as unknown as { translation: string }).translation).toBe("local");
  });

  it("newer server row wins over a stale local copy", () => {
    const merged = mergeWordsLastWriteWins(
      [{ word: "apple", bookId: "b1", timeUpdated: 300, translation: "server" } as never],
      [{ word: "apple", bookId: "b1", timeUpdated: 200, translation: "local" } as never],
      keyOf,
      (w) => ({ ...w } as never),
    );
    expect((merged[0] as unknown as { translation: string }).translation).toBe("server");
  });
});
